import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, onSnapshot, collection, addDoc, deleteDoc, doc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
	apiKey: "YOUR_API_KEY",
	authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
	projectId: "YOUR_PROJECT_ID",
	storageBucket: "YOUR_PROJECT_ID.appspot.com",
	messagingSenderId: "YOUR_SENDER_ID",
	appId: "YOUR_APP_ID"
};

// 初始化 Firebase
const appId = "grand-tour-1c4f8"; // 固定 App ID
let app, db, auth;
let userId = null;
let isAuthReady = false;
let isFirebaseAvailable = false;

try {
	app = initializeApp(firebaseConfig);
	db = getFirestore(app);
	auth = getAuth(app);
	console.log("Firebase 初始化成功");
} catch (e) {
	console.error("Firebase 初始化失敗，請檢查 config 設定", e);
}

let currentView = { name: 'home', data: null };
const viewHistory = [];
let weatherCache = {};
let isRateRealTime = false; // 標記是否成功取得即時匯率


// 預設匯率表 (作為備案)
let exchangeRates = {
	'TWD': 1, 'USD': 30, 'MYR': 7.3, 'THB': 0.95, 'NPR': 0.24,
	'INR': 0.39, 'AED': 8.85, 'KES': 0.25, 'EGP': 0.67, 'AMD': 0.08, 'EUR': 34.5
};

// 取得即時匯率
async function fetchRealTimeRates() {
	try {
		const response = await fetch('https://api.exchangerate-api.com/v4/latest/TWD');
		if (!response.ok) throw new Error('Network response was not ok');

		const data = await response.json();
		const rates = data.rates;

		for (const [currency, rate] of Object.entries(rates)) {
			if (rate !== 0) {
				exchangeRates[currency] = 1 / rate;
			}
		}

		exchangeRates['TWD'] = 1;
		isRateRealTime = true;

		if (currentView.name === 'tools') {
			renderTools();
		}

	} catch (error) {
		console.warn('無法取得即時匯率，將使用預設值:', error);
		isRateRealTime = false;
	}
}

const countryCoords = {
	'馬來西亞': { lat: 3.1390, lon: 101.6869 }, // Kuala Lumpur
	'泰國': { lat: 13.7563, lon: 100.5018 }, // Bangkok
	'尼泊爾': { lat: 27.7172, lon: 85.3240 }, // Kathmandu
	'印度': { lat: 28.6139, lon: 77.2090 }, // New Delhi
	'杜拜': { lat: 25.2048, lon: 55.2708 },
	'肯亞': { lat: -1.2921, lon: 36.8219 }, // Nairobi
	'埃及': { lat: 30.0444, lon: 31.2357 }, // Cairo
	'亞美尼亞': { lat: 40.1872, lon: 44.5152 }, // Yerevan
	'希臘': { lat: 37.9838, lon: 23.7275 }, // Athens
	'義大利': { lat: 41.9028, lon: 12.4964 }, // Rome
	'巴黎': { lat: 48.8566, lon: 2.3522 },
	'朝聖之路': { lat: 42.8782, lon: -8.5448 } // Santiago de Compostela
};

// 天氣代碼轉換 (WMO Weather interpretation codes)
function getWeatherDesc(code) {
	if (code === 0) return { icon: '☀️', text: '晴朗' };
	if (code >= 1 && code <= 3) return { icon: '⛅', text: '多雲' };
	if (code >= 45 && code <= 48) return { icon: '🌫️', text: '有霧' };
	if (code >= 51 && code <= 55) return { icon: '🌧️', text: '毛毛雨' };
	if (code >= 56 && code <= 57) return { icon: '🌧️', text: '凍雨' };
	if (code >= 61 && code <= 65) return { icon: '🌧️', text: '下雨' };
	if (code >= 66 && code <= 67) return { icon: '🌧️', text: '凍雨' };
	if (code >= 71 && code <= 77) return { icon: '❄️', text: '降雪' };
	if (code >= 80 && code <= 82) return { icon: '🌦️', text: '陣雨' };
	if (code >= 85 && code <= 86) return { icon: '❄️', text: '雪陣雨' };
	if (code >= 95 && code <= 99) return { icon: '⛈️', text: '雷雨' };
	return { icon: '🌡️', text: '未知' };
}

// 取得真實天氣 (Open-Meteo API)
async function fetchWeather(country) {
	if (weatherCache[country]) return weatherCache[country];

	const coords = countryCoords[country];
	if (!coords) return "無位置資訊";

	try {
		const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current_weather=true&timezone=auto`);
		if (!res.ok) throw new Error('Weather API error');

		const data = await res.json();
		const current = data.current_weather;

		if (current) {
			const desc = getWeatherDesc(current.weathercode);
			const result = `${desc.icon} ${desc.text} ${current.temperature}°C`;
			weatherCache[country] = result;
			return result;
		}
	} catch (e) {
		console.warn('天氣獲取失敗:', e);
	}
	return "暫無法取得";
}

// 各國起始日期 (用於推算 Day 1 是幾月幾號)
const countryStartDates = {
	'馬來西亞': { month: 3, day: 15 },
	'泰國': { month: 3, day: 20 },
	'尼泊爾': { month: 3, day: 28 },
	'印度': { month: 4, day: 5 },
	'杜拜': { month: 4, day: 20 },
	'肯亞': { month: 4, day: 25 },
	'埃及': { month: 5, day: 5 },
	'亞美尼亞': { month: 5, day: 15 },
	'希臘': { month: 5, day: 25 },
	'義大利': { month: 6, day: 5 },
	'巴黎': { month: 6, day: 15 },
	'朝聖之路': { month: 6, day: 20 }
};

// 全域變數：行程資料與國家列表
let itineraryData = {};
let countries = [];

// [新增] 載入行程資料函式
async function loadItineraryData() {
	// 1. 優先從 LocalStorage 讀取 (使用者如果手動匯入過)
	const storedData = localStorage.getItem('customItineraryData');
	if (storedData) {
		try {
			itineraryData = JSON.parse(storedData);
			countries = Object.keys(itineraryData);
			console.log('已從 LocalStorage 載入自訂行程');
			return;
		} catch (e) {
			console.error('LocalStorage 資料損毀，嘗試載入預設 JSON', e);
		}
	}

	// 2. 從 JSON 檔案讀取 (預設行為)
	try {
		const response = await fetch('/public/plan.json');
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		itineraryData = await response.json();
		countries = Object.keys(itineraryData);
		console.log('已載入外部行程檔案 itinerary_data.json');
	} catch (error) {
		console.error('無法載入行程檔案:', error);
		// Fallback: 如果連檔案都讀不到，給一個提示用的空資料
		itineraryData = {
			"載入失敗": {
				"flag": "⚠️",
				"tools": {},
				"Day 1": [{ "type": "Info", "name": "請檢查 plan.json 是否存在", "time": "全天" }]
			}
		};
		countries = ["載入失敗"];
	}
}

// UI 元素
const contentArea = document.getElementById('content-area');
const headerTitle = document.getElementById('header-title');
const backButton = document.getElementById('back-button');
const navButtons = document.querySelectorAll('.nav-button');

// Modal UI
const guideBackdrop = document.getElementById('guide-backdrop');
const guideSheet = document.getElementById('guide-sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetBody = document.getElementById('sheet-body');

let currentCountryName = null;

// 日期計算 helper
function calculateDate(dayKey, country = null) {
	let startMonth = 3;
	let startDay = 15;
	if (country && countryStartDates[country]) {
		startMonth = countryStartDates[country].month;
		startDay = countryStartDates[country].day;
	} else if (currentCountryName && countryStartDates[currentCountryName]) {
		startMonth = countryStartDates[currentCountryName].month;
		startDay = countryStartDates[currentCountryName].day;
	}
	const dayNum = parseInt(dayKey.replace('Day ', ''));
	if (isNaN(dayNum)) return dayKey;
	let currentMonth = startMonth;
	let currentDay = startDay + (dayNum - 1);
	while (true) {
		const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		if (currentDay <= daysInMonth[currentMonth]) break;
		currentDay -= daysInMonth[currentMonth];
		currentMonth++;
	}
	return `${currentMonth}月${currentDay}日`;
}

// 攻略彈窗
window.openGuideModal = function (title, guideContent, location) {
	sheetTitle.textContent = title;
	let parsedContent = guideContent.replace(/\n/g, '<br>');
	const tags = [
		{ keyword: '必吃美食', color: 'bg-yellow-200 text-yellow-900' },
		{ keyword: '必點菜單', color: 'bg-red-200 text-red-900' },
		{ keyword: '必買伴手禮', color: 'bg-pink-200 text-pink-900' },
		{ keyword: '重要預約代號', color: 'bg-indigo-200 text-indigo-900' },
		{ keyword: '攻略', color: 'bg-green-200 text-green-900' },
		{ keyword: '提醒', color: 'bg-orange-200 text-orange-900' },
		{ keyword: '小撇步', color: 'bg-blue-200 text-blue-900' },
	];
	tags.forEach(tag => {
		const regex = new RegExp(`(${tag.keyword})`, 'g');
		parsedContent = parsedContent.replace(regex, `<span class="tag-style ${tag.color} mr-1">${tag.keyword}</span>`);
	});
	parsedContent = parsedContent.replace(/([A-Z0-9]{5,}|[0-9]{5,})/g, '<strong class="text-lg text-red-600 bg-red-50 px-1 rounded">$1</strong>');
	sheetBody.innerHTML = `
		<div class="mb-6"><p class="text-gray-700 leading-relaxed text-base">${parsedContent}</p></div>
		<div class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
			<h4 class="text-sm font-bold text-gray-800 mb-2">可以新增筆記:</h4>
			<textarea class="w-full p-2 bg-gray-50 rounded border border-gray-200 text-sm focus:outline-none focus:border-red-300" rows="3" placeholder="在這裡寫下您的個人筆記..."></textarea>
			<button class="mt-2 w-full py-2 bg-gray-800 text-white rounded-lg text-sm font-semibold hover:bg-gray-700">儲存筆記</button>
		</div>
		<button onclick="handleNavigation('${location}, ${currentCountryName}')" class="mt-6 w-full py-3 bg-red-500 text-white rounded-xl shadow-lg hover:bg-red-600 transition duration-150 ease-in-out font-bold text-base flex items-center justify-center"><i class="fas fa-location-arrow mr-2"></i> 立即導航</button>
	`;
	guideBackdrop.classList.remove('hidden');
	setTimeout(() => { guideBackdrop.classList.add('active'); guideSheet.classList.add('active'); }, 10);
};

window.closeGuideModal = function () {
	guideBackdrop.classList.remove('active'); guideSheet.classList.remove('active');
	setTimeout(() => { guideBackdrop.classList.add('hidden'); }, 300);
};

function updateUIForView(viewName, title, showBack) {
	headerTitle.textContent = title;
	backButton.classList.toggle('hidden', !showBack);
	navButtons.forEach(btn => {
		const btnView = btn.getAttribute('data-view');
		if (viewName === btnView || (viewName !== 'tools' && viewName !== 'calendar' && btnView === 'home')) {
			btn.classList.replace('text-gray-400', 'text-red-500');
		} else {
			btn.classList.replace('text-red-500', 'text-gray-400');
		}
	});
}

function renderCalendar() {
	updateUIForView('calendar', '旅程行事曆', true);
	currentCountryName = null;
	headerTitle.classList.remove('english-title');
	let allEvents = [];
	countries.forEach(country => {
		const days = itineraryData[country];
		Object.keys(days).forEach(key => {
			if (key.startsWith('Day')) {
				const dateStr = calculateDate(key, country);
				const items = days[key];
				items.forEach(item => { allEvents.push({ date: dateStr, ...item, country: country }); });
			}
		});
	});
	allEvents.sort((a, b) => {
		const dateA = a.date.split('月'); const dateB = b.date.split('月');
		const monthA = parseInt(dateA[0]); const monthB = parseInt(dateB[0]);
		if (monthA !== monthB) return monthA - monthB;
		return parseInt(dateA[1]) - parseInt(dateB[1]);
	});
	const eventsHtml = allEvents.map((evt, index) => {
		const bgColor = 'bg-white border-gray-100'; const iconColor = 'text-red-500';
		let dateHeader = '';
		if (index === 0 || allEvents[index - 1].date !== evt.date) {
			dateHeader = `<div class="flex items-center mt-6 mb-3"><div class="w-3 h-3 rounded-full bg-red-400 mr-3 ring-4 ring-white relative z-10"></div><span class="text-sm font-bold text-gray-500">${evt.date} <span class="text-xs font-normal text-gray-400 ml-1">(${evt.country})</span></span></div>`;
		}
		return `${dateHeader}<div class="ml-4 pl-6 border-l-2 border-gray-100 relative pb-4 last:border-0 last:pb-0"><div class="minimal-shadow rounded-lg p-3 border ${bgColor}"><div class="flex justify-between items-start"><div><h4 class="font-bold text-gray-800 text-sm flex items-center">${evt.name}</h4><p class="text-xs text-gray-500 mt-1"><i class="far fa-clock mr-1"></i> ${evt.time || '全天'}</p></div><i class="fas fa-map-marker-alt ${iconColor} mt-1"></i></div></div></div>`;
	}).join('');
	contentArea.innerHTML = `<div class="p-2 relative"><div class="mb-4 bg-red-50 rounded-xl p-4 border border-red-100"><h3 class="font-bold text-red-800 mb-1 flex items-center"><i class="fas fa-calendar-check mr-2"></i> 行程總覽</h3><p class="text-xs text-red-600">這裡自動彙整了您所有國家的行程安排。</p></div><div class="relative"><div class="timeline-line"></div>${eventsHtml}</div><div class="text-center mt-8 pb-4"><p class="text-xs text-gray-400">--- 旅程待續 ---</p></div></div>`;
}

function renderItineraryCard(item) {
	let icon, color;
	switch (item.type) {
		case 'Attraction': icon = 'fas fa-camera-retro'; color = 'bg-green-50 text-green-800'; break;
		case 'Restaurant': icon = 'fas fa-utensils'; color = 'bg-red-50 text-red-800'; break;
		case 'Transportation': icon = 'fas fa-car-side'; color = 'bg-blue-50 text-blue-800'; break;
		default: icon = 'fas fa-info-circle'; color = 'bg-gray-50 text-gray-800';
	}
	const safeName = item.name.replace(/'/g, "\\'");
	const safeGuide = (item.guide || '').replace(/'/g, "\\'").replace(/\n/g, "\\n");
	const safeLocation = item.location.replace(/'/g, "\\'");
	return `<div class="minimal-shadow rounded-xl p-4 mb-4 bg-white border border-gray-100 transition duration-300 ease-in-out"><div class="flex justify-between items-start mb-3 pb-2 border-b border-gray-50"><div class="flex items-center"><div class="w-8 h-8 rounded-full ${color} flex items-center justify-center mr-3"><i class="${icon} text-sm"></i></div><h3 class="text-lg font-bold text-gray-800 leading-tight">${item.name}</h3></div></div><div class="flex items-center text-sm text-gray-500 mb-4 px-1"><i class="far fa-clock mr-2"></i> ${item.time || '全天'}<span class="mx-2">|</span><i class="fas fa-map-marker-alt mr-2"></i> ${item.location}</div><button onclick="openGuideModal('${safeName}', '${safeGuide}', '${safeLocation}')" class="w-full py-2.5 bg-gray-800 text-white rounded-lg text-sm font-semibold shadow hover:bg-gray-700 transition flex items-center justify-center"><i class="fas fa-book-open mr-2"></i> 查看導遊攻略與詳情</button></div>`;
}

async function renderCountry(countryName) {
	const targetCountry = countryName || countries[0];
	currentCountryName = targetCountry;
	updateUIForView('home', '一路向西 直到世界盡頭', false);
	headerTitle.classList.remove('english-title');

	let navContainer = document.getElementById('country-nav-scroll');
	const navHtml = `<div id="country-nav-scroll" class="flex overflow-x-auto pb-2 mb-2 space-x-2 bg-white sticky top-0 z-10 pt-2 border-b border-gray-100 hide-scrollbar px-2">${countries.map(c => { let displayName = c.includes('(') ? c.split('(')[0] : c; return `<button id="nav-btn-${c}" onclick="window.navigateTo('country', '${c}')" class="flex items-center justify-center px-4 py-2 rounded-full border text-sm font-bold transition-all duration-300 whitespace-nowrap snap-center shrink-0 nav-pill-inactive hover:bg-gray-50">${displayName}</button>`; }).join('')}</div><div id="country-dynamic-content" class="transition-opacity duration-200"></div>`;

	if (!navContainer || navContainer.querySelectorAll('button').length !== countries.length) {
		contentArea.innerHTML = navHtml;
		navContainer = document.getElementById('country-nav-scroll');
	}

	countries.forEach(c => { const btn = document.getElementById(`nav-btn-${c}`); if (btn) btn.className = c === targetCountry ? 'flex items-center justify-center px-4 py-2 rounded-full border text-sm font-bold transition-all duration-300 whitespace-nowrap snap-center shrink-0 nav-pill-active shadow-md scale-105' : 'flex items-center justify-center px-4 py-2 rounded-full border text-sm font-bold transition-all duration-300 whitespace-nowrap snap-center shrink-0 nav-pill-inactive hover:bg-gray-50'; });
	requestAnimationFrame(() => { const activeBtn = document.getElementById(`nav-btn-${targetCountry}`); if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); });

	// 呼叫 Open-Meteo API
	const weatherInfo = await fetchWeather(targetCountry);
	const weatherHtml = `<div id="weather-section" class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100 flex items-center justify-between"><div class="flex items-center text-blue-800"><div><p class="text-xs text-blue-500 font-bold mb-0.5">天氣預報</p><p id="weather-text-inner" class="text-sm font-semibold">${weatherInfo}</p></div></div><div class="text-blue-300 text-xs">Open-Meteo</div></div>`;

	const days = itineraryData[targetCountry] ? Object.keys(itineraryData[targetCountry]).filter(key => key.startsWith('Day')).sort() : [];
	let contentHtml = '';
	if (days.length === 0) { contentHtml = `<div class="text-center p-8 mt-4 bg-gray-50 rounded-xl border border-dashed border-gray-200"><span class="text-5xl text-gray-200 mb-4 block filter grayscale opacity-50">${itineraryData[targetCountry]?.flag || '🏴'}</span><p class="text-base font-semibold text-gray-600">尚未安排行程</p></div>`; }
	else { contentHtml = `<div class="space-y-3"><h2 class="text-lg font-bold text-gray-800 px-1 mb-2">行程總覽</h2>${days.map(day => { const dateStr = calculateDate(day, targetCountry); return `<button onclick="window.navigateTo('day', {country: '${targetCountry}', day: '${day}'})" class="minimal-shadow w-full flex items-center justify-between p-4 bg-white rounded-lg border border-gray-100 hover:bg-red-50 transition duration-150 ease-in-out group"><div class="flex items-center"><div class="w-12 h-12 rounded-xl bg-red-50 border border-red-100 flex flex-col items-center justify-center text-red-600 mr-4 group-hover:bg-red-500 group-hover:text-white transition-colors"><span class="text-xs font-bold leading-none mb-0.5">${dateStr.split('月')[0]}月</span><span class="text-lg font-bold leading-none">${dateStr.split('月')[1].replace('日', '')}</span></div><div class="text-left"><p class="text-base font-bold text-gray-800">${day}</p><p class="text-xs text-gray-500 mt-0.5">${dateStr}</p></div></div><i class="fas fa-chevron-right text-gray-300 group-hover:text-red-400"></i></button>` }).join('')}</div>`; }
	const contentContainer = document.getElementById('country-dynamic-content');
	if (contentContainer) { contentContainer.innerHTML = weatherHtml + contentHtml; }
}

function renderDayItinerary(data) {
	const { country, day } = data; const dateStr = calculateDate(day, country);
	updateUIForView('day', `${country} - ${dateStr}`, true); currentCountryName = country;
	const dailyItinerary = itineraryData[country][day] || [];
	contentArea.innerHTML = `<div class="mb-4 flex items-center text-sm text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-100"><span class="mr-2 text-2xl">${itineraryData[country].flag}</span><div class="flex flex-col"><span class="font-bold text-gray-800">${country}</span><span class="text-xs">${dateStr} 行程詳情</span></div></div>${dailyItinerary.map(renderItineraryCard).join('')}`;
}

const ui = {
	header: () => document.getElementById('header-title'),
	back: () => document.getElementById('back-button'),
	content: () => document.getElementById('content-area'),
	navs: () => document.querySelectorAll('.nav-button')
};
const updateUI = (view, title, back) => {
	ui.header().textContent = title;
	ui.back().classList.toggle('hidden', !back);
	ui.navs().forEach(btn => {
		const target = btn.getAttribute('data-view');
		const active = view === target || (view !== 'tools' && view !== 'calendar' && target === 'home');
		btn.className = `nav-button flex flex-col items-center p-2 w-1/3 ${active ? 'text-red-500' : 'text-gray-400'}`;
	});
};

// --- 工具箱渲染邏輯 ---
const renderTools = () => {
	updateUI('tools', '旅途工具箱', true);
	const importSection = `<div class="mb-6 bg-white rounded-xl p-4 border border-gray-200 minimal-shadow mx-1"><h3 class="text-sm font-bold text-gray-700 mb-2 flex items-center"><i class="fas fa-file-import mr-2 text-blue-500"></i>資料管理</h3><button onclick="window.openEditorModal()" class="w-full mb-3 py-2.5 bg-indigo-600 text-white rounded-lg font-bold shadow-sm hover:bg-indigo-700 flex items-center justify-center">
                <i class="fas fa-edit mr-2"></i> 開啟行程編輯器 (新增/修改/匯出)
            </button><div class="flex gap-2"><label class="flex-1 cursor-pointer py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold text-center hover:bg-blue-100 transition border border-blue-100">匯入 JSON<input type="file" class="hidden" accept=".json" onchange="window.handleFileUpload(event)"></label><button onclick="window.resetItinerary()" class="px-3 py-2 bg-gray-100 text-gray-500 rounded-lg text-sm font-semibold hover:bg-gray-200 transition"><i class="fas fa-undo"></i></button></div></div>`;

	if (!currentCountryName) {
		// Global View
		let allAccommodationsHtml = '', allFlightsHtml = '';
		countries.forEach(c => {
			// [更新] 處理陣列或單一物件
			const accs = Array.isArray(itineraryData[c].accommodation) ? itineraryData[c].accommodation : (itineraryData[c].accommodation ? [itineraryData[c].accommodation] : []);
			const flts = Array.isArray(itineraryData[c].flight) ? itineraryData[c].flight : (itineraryData[c].flight ? [itineraryData[c].flight] : []);
			const flag = itineraryData[c]?.flag || '';

			accs.forEach(acc => {
				allAccommodationsHtml += `<div class="bg-white border-l-4 border-green-500 p-3 mb-2 rounded shadow-sm"><div class="flex justify-between items-center mb-1"><h4 class="font-bold text-sm text-gray-800"><span class="mr-2">${flag}</span>${acc.name}</h4><span class="text-xs text-gray-400">${c}</span></div><p class="text-xs text-gray-600 mb-1"><i class="fas fa-map-marker-alt mr-1"></i>${acc.address}</p></div>`;
			});
			flts.forEach(flt => {
				allFlightsHtml += `<div class="bg-white border-l-4 border-blue-500 p-3 mb-2 rounded shadow-sm"><div class="flex justify-between items-center mb-1"><h4 class="font-bold text-sm text-gray-800"><span class="mr-2">${flag}</span>${flt.code}</h4><span class="text-xs text-gray-400">${c}</span></div><p class="text-xs text-gray-600 mb-1"><i class="fas fa-plane mr-1"></i>${flt.route}</p></div>`;
			});
		});

		ui.content().innerHTML = `${importSection}<h2 class="text-2xl font-bold text-gray-800 mb-6 border-b pb-2 mx-1"><i class="fas fa-globe-asia text-red-500 mr-2"></i> 全球通用資訊</h2><div class="space-y-6 mx-1"><div class="minimal-shadow rounded-xl p-4 bg-yellow-50 border border-yellow-100"><h3 class="text-lg font-bold text-yellow-800 mb-2 flex items-center"><i class="fas fa-piggy-bank mr-2"></i> 總花費</h3><div id="budget-info"><p class="text-sm font-semibold text-gray-600">載入中...</p></div></div><div class="minimal-shadow rounded-xl p-4 bg-green-50 border border-green-100"><h3 class="text-lg font-bold text-green-800 mb-3 flex items-center"><i class="fas fa-bed mr-2"></i> 住宿總覽</h3><div class="max-h-60 overflow-y-auto pr-1">${allAccommodationsHtml || '<p class="text-xs text-gray-400">無資料</p>'}</div></div><div class="minimal-shadow rounded-xl p-4 bg-blue-50 border border-blue-100"><h3 class="text-lg font-bold text-blue-800 mb-3 flex items-center"><i class="fas fa-plane-departure mr-2"></i> 航班總覽</h3><div class="max-h-60 overflow-y-auto pr-1">${allFlightsHtml || '<p class="text-xs text-gray-400">無資料</p>'}</div></div></div>`;
	} else {
		// Country View
		const tools = itineraryData[currentCountryName].tools;
		const embassy = itineraryData[currentCountryName].embassy;
		const flag = itineraryData[currentCountryName].flag;
		const currCode = tools ? tools.currencyCode : '';
		const rateStatus = isRateRealTime ? '<span class="text-xs text-green-600 bg-green-50 px-2 rounded ml-2">即時</span>' : '<span class="text-xs text-gray-500 bg-gray-100 px-2 rounded ml-2">預設</span>';

		// [更新] 處理陣列
		const accs = Array.isArray(itineraryData[currentCountryName].accommodation) ? itineraryData[currentCountryName].accommodation : (itineraryData[currentCountryName].accommodation ? [itineraryData[currentCountryName].accommodation] : []);
		const flts = Array.isArray(itineraryData[currentCountryName].flight) ? itineraryData[currentCountryName].flight : (itineraryData[currentCountryName].flight ? [itineraryData[currentCountryName].flight] : []);

		let emergencyHtml = '';
		if (tools || embassy) {
			let embHtml = embassy ? `<div class="mt-3 pt-3 border-t border-red-100"><p class="font-bold text-sm text-red-900 mb-1">🇹🇼 外館</p><p class="font-bold text-base text-gray-800">${embassy.name}</p><p class="text-xs text-gray-600 mt-1">${embassy.address}</p><button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(embassy.address)}', '_blank')" class="mt-2 w-full py-1.5 bg-red-600 text-white rounded text-xs font-bold">導航</button></div>` : '';
			emergencyHtml = `<div class="minimal-shadow rounded-xl p-4 bg-red-50 border border-red-100"><h3 class="text-lg font-bold text-red-800 mb-2 flex items-center"><i class="fas fa-ambulance mr-2"></i> 緊急救援</h3><div class="space-y-1 text-sm text-gray-700"><p><strong>報警:</strong> <span class="font-bold text-red-600 text-lg">${tools?.emergency || '112'}</span></p></div>${embHtml}</div>`;
		}

		let rateHtml = '';
		if (currCode && currCode !== 'TWD') {
			const rTwd = exchangeRates[currCode] ? (1 / exchangeRates[currCode]) : 0;
			const rLoc = exchangeRates[currCode] || 0;
			rateHtml = `<div class="minimal-shadow rounded-xl p-4 bg-white border border-gray-200"><h3 class="text-lg font-bold text-gray-800 mb-2 flex items-center"><i class="fas fa-exchange-alt mr-2 text-blue-500"></i> 匯率 ${rateStatus}</h3><div class="flex justify-between items-center bg-gray-50 p-3 rounded-lg"><div class="text-center w-1/2 border-r"><p class="text-xs text-gray-500">1 TWD ≈</p><p class="text-xl font-bold text-blue-600">${rLoc.toFixed(2)} ${currCode}</p></div><div class="text-center w-1/2"><p class="text-xs text-gray-500">1 ${currCode} ≈</p><p class="text-xl font-bold text-blue-600">${rTwd.toFixed(2)} TWD</p></div></div></div>`;
		}

		let accHtml = accs.map(acc => `<div class="minimal-shadow rounded-xl p-4 bg-green-50 border border-green-100 mb-2"><h3 class="text-lg font-bold text-green-800 mb-2 flex items-center"><i class="fas fa-bed mr-2"></i> ${acc.name}</h3><p class="text-xs text-gray-700 mb-1">${acc.address}</p><div class="flex gap-2 text-xs text-gray-500 mb-1"><span>In: ${acc.checkIn}</span><span>Out: ${acc.checkOut}</span></div><p class="text-xs text-green-700 bg-green-100 p-1 rounded">${acc.note}</p><button onclick="window.open('${acc.gmap}', '_blank')" class="mt-2 w-full py-1.5 bg-green-600 text-white rounded text-xs font-bold">導航</button></div>`).join('');

		let fltHtml = flts.map(flt => `<div class="minimal-shadow rounded-xl p-4 bg-blue-50 border border-blue-100 mb-2"><h3 class="text-lg font-bold text-blue-800 mb-2 flex items-center"><i class="fas fa-plane-departure mr-2"></i> ${flt.code}</h3><p class="text-xs text-gray-700 mb-1">${flt.route}</p><p class="text-xs text-gray-500">${flt.time}</p><p class="text-xs text-blue-600 mt-1">${flt.note}</p></div>`).join('');

		ui.content().innerHTML = `<h2 class="text-2xl font-bold text-gray-800 mb-6 border-b pb-2 mx-1"><i class="fas fa-tools text-red-500 mr-2"></i> 【${flag} ${currentCountryName} 工具】</h2><div class="space-y-6 mx-1">${emergencyHtml}${rateHtml}${accHtml}${fltHtml}<div class="minimal-shadow rounded-xl p-4 bg-yellow-50 border border-yellow-100"><h3 class="text-lg font-bold text-yellow-800 mb-2 flex items-center"><i class="fas fa-piggy-bank mr-2"></i> ${currentCountryName} 花費</h3><div id="budget-info"><p class="text-sm font-semibold text-gray-600">載入中...</p></div><div id="add-expense-form" class="mt-4 p-3 bg-yellow-100 rounded-lg"><p class="font-semibold text-yellow-800 mb-2">新增支出</p><form onsubmit="window.handleExpenseSubmit(event)"><div class="flex space-x-2 mb-2"><div class="relative w-1/3"><select id="expense-currency" class="w-full p-2 border border-yellow-300 rounded text-sm bg-white"><option value="TWD">TWD</option><option value="USD">USD</option>${currCode && currCode !== 'TWD' && currCode !== 'USD' ? `<option value="${currCode}">${currCode}</option>` : ''}</select></div><input type="number" id="expense-amount" placeholder="金額" required step="0.01" class="w-2/3 p-2 border border-yellow-300 rounded text-sm"></div><input type="text" id="expense-description" placeholder="描述" required class="w-full p-2 mb-3 border border-yellow-300 rounded text-sm"><button type="submit" class="w-full py-2 bg-yellow-600 text-white rounded shadow font-bold text-sm">儲存</button></form></div></div></div>`;
	}
	if (isFirebaseAvailable && auth && auth.currentUser) {
        setupBudgetListener();
    } else {
        // 如果未登入，顯示提示
        const infoDiv = document.getElementById('budget-info');
        if(infoDiv) infoDiv.innerHTML = '<p class="text-sm text-gray-400">登入中或離線模式 (無法讀取雲端資料)</p>';
    }
}

window.openEditorModal = () => {
	// 1. 填入國家選單 (來源是目前的 itineraryData)
	const sel = document.getElementById('edit-select-country');
	sel.innerHTML = '<option value="">-- 新增國家 --</option>' +
		countries.map(c => `<option value="${c}">${itineraryData[c].flag} ${c}</option>`).join('');

	// 重置表單
	window.loadCountryToEditor(''); // 清空

	const b = document.getElementById('editor-backdrop');
	b.classList.remove('hidden');
	// Force reflow for transition
	void b.offsetWidth;
	b.classList.add('active');
	document.getElementById('editor-modal').classList.remove('scale-95', 'opacity-0');
	document.getElementById('editor-modal').classList.add('scale-100', 'opacity-100');
};

window.closeEditorModal = () => {
	const b = document.getElementById('editor-backdrop');
	b.classList.remove('active');
	document.getElementById('editor-modal').classList.remove('scale-100', 'opacity-100');
	document.getElementById('editor-modal').classList.add('scale-95', 'opacity-0');
	setTimeout(() => { b.classList.add('hidden'); }, 300);
};

window.loadCountryToEditor = (countryKey) => {
	const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
	const containerAcc = document.getElementById('editor-acc-container');
	const containerFlt = document.getElementById('editor-flight-container');
	const containerDay = document.getElementById('editor-days-container');
	containerAcc.innerHTML = ''; containerFlt.innerHTML = ''; containerDay.innerHTML = '';

	if (!countryKey) {
		// 清空模式
		setVal('edit-country-name', ''); setVal('edit-country-flag', '');
		setVal('edit-emergency', ''); setVal('edit-timezone', '');
		setVal('edit-curr-code', ''); setVal('edit-curr-name', '');
		setVal('edit-emb-name', ''); setVal('edit-emb-addr', ''); setVal('edit-emb-phone', '');
		return;
	}

	const data = itineraryData[countryKey];
	if (!data) return;

	// 填入基本資料
	setVal('edit-country-name', countryKey);
	setVal('edit-country-flag', data.flag);
	if (data.tools) {
		setVal('edit-emergency', data.tools.emergency);
		setVal('edit-timezone', data.tools.timezone);
		setVal('edit-curr-code', data.tools.currencyCode);
		let cName = data.tools.currency || '';
		if (cName.includes('(')) cName = cName.split('(')[1].replace(')', '');
		setVal('edit-curr-name', cName);
	}
	if (data.embassy) {
		setVal('edit-emb-name', data.embassy.name);
		setVal('edit-emb-addr', data.embassy.address);
		setVal('edit-emb-phone', data.embassy.phone);
	}

	// 填入住宿
	const accs = Array.isArray(data.accommodation) ? data.accommodation : (data.accommodation ? [data.accommodation] : []);
	accs.forEach(acc => window.addEditorAccommodation(acc));

	// 填入航班
	const flts = Array.isArray(data.flight) ? data.flight : (data.flight ? [data.flight] : []);
	flts.forEach(flt => window.addEditorFlight(flt));

	// 填入行程
	const dayKeys = Object.keys(data).filter(k => k.startsWith('Day')).sort((a, b) => parseInt(a.replace('Day ', '')) - parseInt(b.replace('Day ', '')));
	dayKeys.forEach(k => window.addEditorDay(data[k]));
};

// Helper: Add UI Elements for Editor
window.addEditorAccommodation = (data = null) => {
	const div = document.createElement('div');
	div.className = 'bg-white border rounded p-2 text-sm relative editor-acc-row';
	div.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-1 right-1 text-red-500 font-bold">×</button>
        <input class="w-full border mb-1 p-1 rounded acc-name" placeholder="名稱" value="${data?.name || ''}">
        <input class="w-full border mb-1 p-1 rounded acc-addr" placeholder="地址" value="${data?.address || ''}">
        <div class="flex gap-1 mb-1"><input class="w-1/2 border p-1 rounded acc-in" placeholder="In" value="${data?.checkIn || ''}"><input class="w-1/2 border p-1 rounded acc-out" placeholder="Out" value="${data?.checkOut || ''}"></div>
        <input class="w-full border mb-1 p-1 rounded acc-note" placeholder="備註" value="${data?.note || ''}">
        <input class="w-full border p-1 rounded acc-gmap" placeholder="Google Map 連結" value="${data?.gmap || ''}">
    `;
	document.getElementById('editor-acc-container').appendChild(div);
};

window.addEditorFlight = (data = null) => {
	const div = document.createElement('div');
	div.className = 'bg-white border rounded p-2 text-sm relative editor-flt-row';
	div.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-1 right-1 text-red-500 font-bold">×</button>
        <div class="flex gap-1 mb-1"><input class="w-1/2 border p-1 rounded flt-code" placeholder="航班" value="${data?.code || ''}"><input class="w-1/2 border p-1 rounded flt-route" placeholder="航線" value="${data?.route || ''}"></div>
        <div class="flex gap-1"><input class="w-1/2 border p-1 rounded flt-time" placeholder="時間" value="${data?.time || ''}"><input class="w-1/2 border p-1 rounded flt-note" placeholder="備註" value="${data?.note || ''}"></div>
    `;
	document.getElementById('editor-flight-container').appendChild(div);
};

window.addEditorDay = (items = null) => {
	const container = document.getElementById('editor-days-container');
	const dayCount = container.children.length + 1;
	const div = document.createElement('div');
	div.className = 'bg-white border-l-4 border-blue-500 p-3 mb-3 rounded shadow-sm editor-day-block';
	div.dataset.dayId = `Day ${dayCount}`;
	div.innerHTML = `
        <div class="flex justify-between items-center mb-2"><h5 class="font-bold text-blue-700">Day ${dayCount}</h5><button onclick="this.parentElement.parentElement.remove()" class="text-xs text-red-500">刪除</button></div>
        <div class="editor-items-container space-y-2"></div>
        <button onclick="window.addEditorItem(this)" class="mt-2 text-xs text-blue-600 font-bold">+ 景點</button>
    `;
	container.appendChild(div);
	const itemContainer = div.querySelector('.editor-items-container');
	if (items && Array.isArray(items)) {
		items.forEach(item => window.createEditorItem(itemContainer, item));
	}
};

window.addEditorItem = (btn) => { window.createEditorItem(btn.previousElementSibling); };
window.createEditorItem = (container, data = null) => {
	const div = document.createElement('div');
	div.className = 'border p-2 rounded bg-gray-50 text-sm relative editor-item-row';
	div.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-1 right-1 text-red-500 font-bold">×</button>
        <div class="flex gap-1 mb-1">
            <select class="border p-1 rounded w-1/3 item-type"><option value="Attraction" ${data?.type === 'Attraction' ? 'selected' : ''}>景點</option><option value="Restaurant" ${data?.type === 'Restaurant' ? 'selected' : ''}>餐廳</option><option value="Transportation" ${data?.type === 'Transportation' ? 'selected' : ''}>交通</option></select>
            <input class="border p-1 rounded w-2/3 item-name" placeholder="名稱" value="${data?.name || ''}">
        </div>
        <div class="flex gap-1 mb-1"><input class="border p-1 rounded w-1/2 item-time" placeholder="時間" value="${data?.time || ''}"><input class="border p-1 rounded w-1/2 item-loc" placeholder="地點" value="${data?.location || ''}"></div>
        <textarea class="w-full border p-1 rounded item-guide" rows="2" placeholder="攻略">${data?.guide || ''}</textarea>
    `;
	container.appendChild(div);
};

// 匯出 JSON 並下載
window.downloadEditorJSON = () => {
	// 1. 抓取表單資料
	const countryName = document.getElementById('edit-country-name').value.trim();
	if (!countryName) return alert('請輸入國家名稱');

	const getVal = (id) => document.getElementById(id)?.value || '';

	// 收集 Accommodations
	const accs = [];
	document.querySelectorAll('.editor-acc-row').forEach(row => {
		if (row.querySelector('.acc-name').value) {
			accs.push({
				name: row.querySelector('.acc-name').value,
				address: row.querySelector('.acc-addr').value,
				checkIn: row.querySelector('.acc-in').value,
				checkOut: row.querySelector('.acc-out').value,
				note: row.querySelector('.acc-note').value,
				gmap: row.querySelector('.acc-gmap').value
			});
		}
	});

	// 收集 Flights
	const flts = [];
	document.querySelectorAll('.editor-flt-row').forEach(row => {
		if (row.querySelector('.flt-code').value) {
			flts.push({
				code: row.querySelector('.flt-code').value,
				route: row.querySelector('.flt-route').value,
				time: row.querySelector('.flt-time').value,
				note: row.querySelector('.flt-note').value
			});
		}
	});

	// 建構新資料物件
	const newCountryData = {
		flag: getVal('edit-country-flag'),
		tools: {
			emergency: getVal('edit-emergency'),
			currency: `${getVal('edit-curr-code')} (${getVal('edit-curr-name')})`,
			currencyCode: getVal('edit-curr-code'),
			timezone: getVal('edit-timezone')
		},
		embassy: {
			name: getVal('edit-emb-name'),
			address: getVal('edit-emb-addr'),
			phone: getVal('edit-emb-phone')
		},
		accommodation: accs,
		flight: flts
	};

	// 收集每日行程
	document.querySelectorAll('.editor-day-block').forEach((block, idx) => {
		const dayKey = `Day ${idx + 1}`;
		const items = [];
		block.querySelectorAll('.editor-item-row').forEach(row => {
			if (row.querySelector('.item-name').value) {
				items.push({
					type: row.querySelector('.item-type').value,
					name: row.querySelector('.item-name').value,
					location: row.querySelector('.item-loc').value,
					time: row.querySelector('.item-time').value,
					guide: row.querySelector('.item-guide').value
				});
			}
		});
		if (items.length > 0) newCountryData[dayKey] = items;
	});

	// 2. 更新全域 itineraryData
	itineraryData[countryName] = newCountryData;
	countries = Object.keys(itineraryData); // Refresh keys if new country

	// 3. 下載檔案
	const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(itineraryData, null, 4));
	const anchor = document.createElement('a');
	anchor.setAttribute("href", dataStr);
	anchor.setAttribute("download", "itinerary_data.json");
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();

	// 4. 同步更新 LocalStorage 與畫面
	localStorage.setItem('customItineraryData', JSON.stringify(itineraryData));
	window.closeEditorModal();
	alert('已下載 JSON，並同步更新目前顯示的行程！');
	renderTools(); // Refresh tool view
};

window.navigateTo = function (viewName, data) {
	if (viewName === 'country' && data === currentCountryName && currentView.name === 'country') return;
	if (currentView.name !== viewName || JSON.stringify(currentView.data) !== JSON.stringify(data)) viewHistory.push(currentView);
	currentView = { name: viewName, data: data };
	renderView(viewName, data);
}

window.goBack = function () {
	if (viewHistory.length > 0) { currentView = viewHistory.pop(); renderView(currentView.name, currentView.data); } else { navigateTo('country', countries[0]); }
}

function renderView(viewName, data) {
	switch (viewName) {
		case 'country': renderCountry(data); break;
		case 'day': renderDayItinerary(data); break;
		case 'tools': renderTools(); break;
		case 'calendar': renderCalendar(); break;
		default: renderCountry(countries[0]);
	}
}

navButtons.forEach(button => {
	button.addEventListener('click', () => {
		const viewName = button.getAttribute('data-view');
		if (viewName === 'home') { viewHistory.length = 0; navigateTo('country', currentCountryName || countries[0]); } else { navigateTo(viewName, null); }
	});
});

window.handleNavigation = function (location) { const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`; window.open(mapUrl, '_blank'); };

window.deleteExpense = async (id) => {
    if (!confirm('確定要刪除這筆花費嗎？')) return;
    if (!db || !auth.currentUser || !appId) return alert('無法操作');
    try {
        // 使用 deleteDoc 和 doc 刪除指定 ID 的文件
        await deleteDoc(doc(db, `artifacts/${appId}/users/${auth.currentUser.uid}/budget_entries`, id));
    } catch (e) {
        console.error("刪除失敗", e);
        alert("刪除失敗: " + e.message);
    }
};

function getBudgetCollectionRef() { 
    // 嚴格檢查：必須有 db 實例，且 auth.currentUser 存在 (代表已登入)
    if (!db || !auth.currentUser || !appId) return null; 
    return collection(db, `artifacts/${appId}/users/${auth.currentUser.uid}/budget_entries`); 
}

function setupBudgetListener() {
	// 1. 檢查 Auth 狀態
	const user = auth.currentUser;
	if (!user) {
		// 如果尚未登入，這裡不執行任何 Firestore 監聽
		// 若需要提示，可在 UI 顯示 "請先登入" 或等待 onAuthStateChanged 觸發重試
		return;
	}
	const uid = user.uid;

	// 2. 檢查 appId
	if (!appId) return;

	// 3. 建立 Collection Reference (不使用 where/orderBy，直接讀取整個集合)
	const budgetRef = collection(db, `artifacts/${appId}/users/${uid}/budget_entries`);

	// 4. 執行監聽，並加入權限錯誤處理
	onSnapshot(budgetRef, (snapshot) => {
		const entries = [];
		snapshot.forEach(doc => entries.push({ id: doc.id, ...doc.data() }));

		// 在記憶體中進行過濾與排序 (Rule 2)
		let targetEntries = entries;
		if (currentCountryName) {
			targetEntries = entries.filter(e => e.country === currentCountryName);
		}
		targetEntries.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));

		updateBudgetUI(targetEntries);
	}, (error) => {
		// 權限錯誤或其他錯誤處理
		console.error("Firestore Error:", error);
		const infoDiv = document.getElementById('budget-info');
		if (infoDiv) infoDiv.innerHTML = '<p class="text-sm text-red-400">無法讀取資料 (權限或連線錯誤)</p>';
	});
}

function updateBudgetUI(entries) {
    const infoDiv = document.getElementById('budget-info');
    if (!infoDiv) return;
    if (entries.length === 0) { infoDiv.innerHTML = '<p class="text-sm text-gray-500">無支出記錄。</p>'; return; }
    
    const total = entries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
    
    let listHtml = entries.slice(0, 5).map(entry => {
        let originalInfo = (entry.originalCurrency && entry.originalCurrency !== 'TWD') ? `<span class="text-xs text-gray-400 ml-1">(${entry.originalCurrency} ${entry.originalAmount})</span>` : '';
        let tag = !currentCountryName ? `<span class="mr-2 text-xs bg-gray-200 px-1 rounded">${entry.country}</span>` : '';
        
        return `
        <div class="flex justify-between items-center text-sm py-2 border-b border-yellow-200 group">
            <div class="flex items-center flex-grow overflow-hidden">
                 ${tag}
                 <span class="text-gray-600 truncate mr-1">${entry.description}</span>
                 ${originalInfo}
            </div>
            <div class="flex items-center flex-shrink-0">
                <span class="font-mono text-red-600 mr-3">TWD ${Math.round(entry.amount)}</span>
                <button onclick="window.deleteExpense('${entry.id}')" class="text-gray-400 hover:text-red-500 px-1">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    infoDiv.innerHTML = `<div class="mb-3 text-center p-2 bg-yellow-100 rounded-lg"><p class="text-sm font-bold text-yellow-800">總支出:</p><p class="text-base font-bold text-yellow-900">TWD ${Math.round(total)}</p></div><p class="text-sm font-semibold text-gray-700 mb-1">最新支出:</p><div class="space-y-1">${listHtml}</div>`;
}

// --- Window Functions ---
window.navigateTo = (view, data) => { viewHistory.push(currentView); currentView = { name: view, data }; renderView(view, data); };
window.goBack = () => { if (viewHistory.length) { currentView = viewHistory.pop(); renderView(currentView.name, currentView.data); } else renderCountry(countries[0]); };
window.openGuideModal = (title, content, loc) => {
	document.getElementById('sheet-title').textContent = title;
	document.getElementById('sheet-body').innerHTML = `<p class="mb-6 text-gray-700 leading-relaxed text-sm whitespace-pre-wrap">${content}</p><button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}', '_blank')" class="w-full py-3 bg-red-500 text-white rounded-xl font-bold shadow-lg">Google Maps 導航</button>`;
	document.getElementById('guide-backdrop').classList.remove('hidden');
	setTimeout(() => { document.getElementById('guide-backdrop').classList.add('active'); document.getElementById('guide-sheet').classList.add('active'); }, 10);
};
window.closeGuideModal = () => {
	document.getElementById('guide-backdrop').classList.remove('active'); document.getElementById('guide-sheet').classList.remove('active');
	setTimeout(() => { document.getElementById('guide-backdrop').classList.add('hidden'); }, 300);
};
window.handleExpenseSubmit = async (e) => {
    e.preventDefault();
    // 使用 auth.currentUser 確保是登入狀態
    const user = auth.currentUser;
    if (!db || !user) return alert('資料庫未連線或未登入');
    
    const amtIn = document.getElementById('expense-amount');
    const descIn = document.getElementById('expense-description');
    const currIn = document.getElementById('expense-currency');
    const rawAmt = parseFloat(amtIn.value);
    const desc = descIn.value.trim();
    const curr = currIn.value;
    
    if (isNaN(rawAmt) || rawAmt <= 0 || desc === "") return;
    
    let amtTWD = rawAmt;
    if (curr !== 'TWD') { const rate = exchangeRates[curr] || 1; amtTWD = rawAmt * rate; }
    
    try {
        // 直接使用 uid
        await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/budget_entries`), {
            description: desc, amount: amtTWD, originalAmount: rawAmt, originalCurrency: curr, timestamp: serverTimestamp(), country: currentCountryName || 'Global'
        });
        amtIn.value = ''; descIn.value = '';
    } catch (err) { console.error("新增失敗", err); alert('新增失敗: ' + err.message); }
};
window.handleFileUpload = (e) => {
	const file = e.target.files[0]; if (!file) return;
	const reader = new FileReader();
	reader.onload = (ev) => {
		try {
			const json = JSON.parse(ev.target.result);
			if (typeof json === 'object') {
				localStorage.setItem('customItineraryData', JSON.stringify(json));
				alert('匯入成功，請重新整理');
				location.reload();
			}
		} catch (err) { alert('JSON 格式錯誤'); }
	};
	reader.readAsText(file);
};
window.resetItinerary = () => { if (confirm('清除自訂行程?')) { localStorage.removeItem('customItineraryData'); location.reload(); } };

// --- 啟動 ---
async function init() {
    await loadItineraryData(); 
    if(auth && isFirebaseAvailable) {
        onAuthStateChanged(auth, (u) => {
            isAuthReady = true; userId = u ? u.uid : null;
            
            // 如果 Auth Ready，可以開始監聽 DB (如果當前是在 Tools 頁面)
            if (currentView.name === 'tools') setupBudgetListener();

            if(!userId) signInAnonymously(auth).catch(console.error);
            if(currentView.name === 'home') renderCountry(countries[0]);
        });
    } else {
        isAuthReady = true;
        renderCountry(countries[0]); 
    }
    fetchRealTimeRates();
}
document.addEventListener('DOMContentLoaded', init);
