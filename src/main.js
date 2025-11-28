import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, onSnapshot, collection, addDoc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
	apiKey: "YOUR_API_KEY",
	authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
	projectId: "YOUR_PROJECT_ID",
	storageBucket: "YOUR_PROJECT_ID.appspot.com",
	messagingSenderId: "YOUR_SENDER_ID",
	appId: "YOUR_APP_ID"
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// 初始化 Firebase
let app, db, auth;
let userId = null;
let isAuthReady = false;

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

// --- 工具箱渲染邏輯 ---
function renderTools() {
	updateUIForView('tools', '旅途工具箱', true);

	if (!currentCountryName) {
		// ... 全球通用工具代碼 (保持不變) ...
		let allAccommodationsHtml = '';
		let allFlightsHtml = '';

		countries.forEach(c => {
			const acc = itineraryData[c].accommodation;
			const flt = itineraryData[c].flight;
			const flag = itineraryData[c].flag;

			if (acc) {
				allAccommodationsHtml += `
					<div class="bg-white border-l-4 border-green-500 p-3 mb-2 rounded shadow-sm">
						<div class="flex justify-between items-center mb-1">
							<h4 class="font-bold text-sm text-gray-800"><span class="mr-2">${flag}</span>${acc.name}</h4>
							<span class="text-xs text-gray-400">${c}</span>
						</div>
						<p class="text-xs text-gray-600 mb-1"><i class="fas fa-map-marker-alt mr-1"></i>${acc.address}</p>
						<div class="flex space-x-2 text-xs text-gray-500">
							<span>入住: ${acc.checkIn}</span><span>退房: ${acc.checkOut}</span>
						</div>
					</div>`;
			}

			if (flt) {
				allFlightsHtml += `
					<div class="bg-white border-l-4 border-blue-500 p-3 mb-2 rounded shadow-sm">
						<div class="flex justify-between items-center mb-1">
							<h4 class="font-bold text-sm text-gray-800"><span class="mr-2">${flag}</span>${flt.code}</h4>
							<span class="text-xs text-gray-400">${c}</span>
						</div>
						<p class="text-xs text-gray-600 mb-1"><i class="fas fa-plane mr-1"></i>${flt.route}</p>
						<p class="text-xs text-gray-500">${flt.time} <span class="ml-2 text-gray-400">(${flt.note})</span></p>
					</div>`;
			}
		});

		if (!allAccommodationsHtml) allAccommodationsHtml = '<p class="text-xs text-gray-400 p-2">尚無住宿資料</p>';
		if (!allFlightsHtml) allFlightsHtml = '<p class="text-xs text-gray-400 p-2">尚無航班資料</p>';

		contentArea.innerHTML = `
			<h2 class="text-2xl font-bold text-gray-800 mb-6 border-b pb-2"><i class="fas fa-globe-asia text-red-500 mr-2"></i> 全球通用資訊</h2>
			
			<div class="space-y-6">
				<div class="minimal-shadow rounded-xl p-4 bg-yellow-50 border border-yellow-100">
					<h3 class="text-lg font-bold text-yellow-800 mb-2 flex items-center"><i class="fas fa-piggy-bank mr-2"></i> 旅程總花費 (所有國家)</h3>
					<div id="budget-info"><p class="text-sm font-semibold text-gray-600">正在統計所有支出...</p></div>
				</div>
				<div class="minimal-shadow rounded-xl p-4 bg-green-50 border border-green-100">
					<h3 class="text-lg font-bold text-green-800 mb-3 flex items-center"><i class="fas fa-bed mr-2"></i> 住宿總覽</h3>
					<div class="max-h-60 overflow-y-auto pr-1">${allAccommodationsHtml}</div>
				</div>
				<div class="minimal-shadow rounded-xl p-4 bg-blue-50 border border-blue-100">
					<h3 class="text-lg font-bold text-blue-800 mb-3 flex items-center"><i class="fas fa-plane-departure mr-2"></i> 航班總覽</h3>
					<div class="max-h-60 overflow-y-auto pr-1">${allFlightsHtml}</div>
				</div>
			</div>
		`;

	} else {
		// === 單一國家工具頁面 ===
		const countryToolData = itineraryData[currentCountryName].tools;
		const accommodation = itineraryData[currentCountryName].accommodation;
		const flight = itineraryData[currentCountryName].flight;
		const embassy = itineraryData[currentCountryName].embassy;
		const countryFlag = itineraryData[currentCountryName].flag;
		const localCurrencyCode = countryToolData ? countryToolData.currencyCode : '';

		const rateStatusHtml = isRateRealTime
			? '<span class="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded ml-2"><i class="fas fa-check-circle mr-1"></i>即時匯率</span>'
			: '<span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded ml-2">預設匯率</span>';

		// 1. 緊急連絡 & 大使館
		let emergencyHtml = '';
		if (countryToolData || embassy) {
			let embassyDetails = '';
			if (embassy) {
				const note = embassy.note ? `<span class="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full ml-2">${embassy.note}</span>` : '';
				embassyDetails = `
					<div class="mt-3 pt-3 border-t border-red-100">
						<p class="font-bold text-sm text-red-900 mb-1">
							<i class="fas fa-landmark mr-1"></i> 中華民國駐外辦事處
							${note}
						</p>
						<p class="font-bold text-base text-gray-800">${embassy.name}</p>
						<p class="text-xs text-gray-600 mt-1 mb-2"><i class="fas fa-map-marker-alt mr-1"></i>${embassy.address}</p>
						<p class="text-xs text-gray-600"><i class="fas fa-phone mr-1"></i>${embassy.phone}</p>
						<button onclick="handleNavigation('${embassy.address}, ${currentCountryName}')" class="mt-2 w-full py-1.5 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700">導航至辦事處</button>
					</div>
				`;
			}

			emergencyHtml = `
				<div class="minimal-shadow rounded-xl p-4 bg-red-50 border border-red-100">
					<h3 class="text-lg font-bold text-red-800 mb-2 flex items-center"><i class="fas fa-ambulance mr-2"></i> 緊急救援與外館</h3>
					<div class="space-y-1 text-sm text-gray-700">
						<p><strong>當地報警/急救:</strong> <span class="font-bold text-red-600 text-lg">${countryToolData.emergency}</span></p>
						<p><strong>外交部緊急聯絡:</strong> +886-800-085-095</p>
					</div>
					${embassyDetails}
				</div>
			`;
		}

		// 2. 即時匯率
		let rateHtml = '';
		if (localCurrencyCode && localCurrencyCode !== 'TWD') {
			const rateToTwd = exchangeRates[localCurrencyCode] ? (1 / exchangeRates[localCurrencyCode]) : 0;
			const rateToLocal = exchangeRates[localCurrencyCode] || 0;

			rateHtml = `
				<div class="minimal-shadow rounded-xl p-4 bg-white border border-gray-200">
					<h3 class="text-lg font-bold text-gray-800 mb-2 flex items-center">
						<i class="fas fa-exchange-alt mr-2 text-blue-500"></i> 即時匯率資訊
						${rateStatusHtml}
					</h3>
					<div class="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
						<div class="text-center w-1/2 border-r border-gray-200">
							<p class="text-xs text-gray-500">1 TWD 約等於</p>
							<p class="text-xl font-bold text-blue-600">${rateToLocal.toFixed(2)} <span class="text-xs text-gray-400">${localCurrencyCode}</span></p>
						</div>
						<div class="text-center w-1/2">
							<p class="text-xs text-gray-500">1 ${localCurrencyCode} 約等於</p>
							<p class="text-xl font-bold text-blue-600">${rateToTwd.toFixed(2)} <span class="text-xs text-gray-400">TWD</span></p>
						</div>
					</div>
				</div>
			`;
		}

		// 住宿 & 航班 (保持不變)
		let accommodationHtml = '';
		if (accommodation) {
			accommodationHtml = `
				<div class="minimal-shadow rounded-xl p-4 bg-green-50 border border-green-100">
					<h3 class="text-lg font-bold text-green-800 mb-2 flex items-center"><i class="fas fa-bed mr-2"></i> 住宿資訊</h3>
					<div class="space-y-1 text-sm text-gray-700">
						<p class="font-bold text-base">${accommodation.name}</p>
						<p><i class="fas fa-map-marker-alt text-green-600 mr-1"></i> ${accommodation.address}</p>
						<div class="flex space-x-4 mt-1"><p><strong>入住:</strong> ${accommodation.checkIn}</p><p><strong>退房:</strong> ${accommodation.checkOut}</p></div>
						<p class="mt-2 text-green-700 bg-green-100 p-2 rounded text-xs">${accommodation.note}</p>
					</div>
					<button onclick="handleNavigation('${accommodation.address}, ${currentCountryName}')" class="mt-2 w-full py-1.5 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700">導航至住宿</button>
				</div>`;
		}

		let flightHtml = '';
		if (flight) {
			flightHtml = `
				<div class="minimal-shadow rounded-xl p-4 bg-blue-50 border border-blue-100">
					<h3 class="text-lg font-bold text-blue-800 mb-2 flex items-center"><i class="fas fa-plane-departure mr-2"></i> 航班資訊</h3>
					<div class="space-y-1 text-sm text-gray-700">
						<p><strong>航班:</strong> ${flight.code} (${flight.route})</p>
						<p><strong>時間:</strong> ${flight.time}</p>
						<p class="mt-2 text-blue-700 bg-blue-100 p-2 rounded text-xs">${flight.note}</p>
					</div>
				</div>`;
		}

		contentArea.innerHTML = `
			<h2 class="text-2xl font-bold text-gray-800 mb-6 border-b pb-2"><i class="fas fa-tools text-red-500 mr-2"></i> 【${countryFlag} ${currentCountryName} 專屬工具】</h2>
			<div class="space-y-6">
				${emergencyHtml}
				${rateHtml}
				${accommodationHtml || ''}
				${flightHtml || ''}
				<div class="minimal-shadow rounded-xl p-4 bg-yellow-50 border border-yellow-100">
					<h3 class="text-lg font-bold text-yellow-800 mb-2 flex items-center">
						<i class="fas fa-piggy-bank mr-2"></i> ${currentCountryName} 花費
					</h3>
					<div id="budget-info"><p class="text-sm font-semibold text-gray-600">正在加載花費數據...</p></div>
					<div id="add-expense-form" class="mt-4 p-3 bg-yellow-100 rounded-lg">
						<p class="font-semibold text-yellow-800 mb-2">新增支出</p>
						<form id="expense-form" onsubmit="handleExpenseSubmit(event)">
							<div class="flex space-x-2 mb-2">
								<div class="relative w-1/3">
									<select id="expense-currency" class="w-full p-2 border border-yellow-300 rounded-md focus:ring-yellow-500 focus:border-yellow-500 text-sm appearance-none bg-white custom-select">
										<option value="TWD">TWD</option>
										<option value="USD">USD</option>
										${localCurrencyCode && localCurrencyCode !== 'TWD' && localCurrencyCode !== 'USD' ? `<option value="${localCurrencyCode}">${localCurrencyCode}</option>` : ''}
									</select>
								</div>
								<input type="number" id="expense-amount" placeholder="金額" required step="0.01" class="w-2/3 p-2 border border-yellow-300 rounded-md focus:ring-yellow-500 focus:border-yellow-500 text-sm">
							</div>
							<input type="text" id="expense-description" placeholder="描述 (例如: 晚餐, 門票)" required class="w-full p-2 mb-3 border border-yellow-300 rounded-md focus:ring-yellow-500 focus:border-yellow-500 text-sm">
							<button type="submit" class="w-full py-2 bg-yellow-600 text-white rounded-lg shadow-md hover:bg-yellow-700 transition duration-150 ease-in-out font-semibold text-sm"><i class="fas fa-save mr-2"></i> 儲存支出</button>
						</form>
					</div>
				</div>
			</div>
		`;
	}
	if (isAuthReady) setupBudgetListener();
}

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
		if(infoDiv) infoDiv.innerHTML = '<p class="text-sm text-red-400">無法讀取資料 (權限或連線錯誤)</p>';
	});
}

function updateBudgetUI(entries) {
	const infoDiv = document.getElementById('budget-info');
	if (!infoDiv) return;
	if (entries.length === 0) { infoDiv.innerHTML = '<p class="text-sm text-gray-500">目前沒有支出記錄。</p>'; return; }

	const total = entries.reduce((sum, entry) => sum + (entry.amount || 0), 0);

	let listHtml = entries.slice(0, 5).map(entry => {
		let originalInfo = '';
		if (entry.originalCurrency && entry.originalCurrency !== 'TWD') {
			originalInfo = `<span class="text-xs text-gray-400 ml-1">(${entry.originalCurrency} ${entry.originalAmount})</span>`;
		}
		// 在 Global View 時顯示國家名稱
		let countryTag = !currentCountryName ? `<span class="mr-2 text-xs bg-gray-200 text-gray-600 px-1 rounded">${entry.country}</span>` : '';

		return `
		<div class="flex justify-between text-sm py-1 border-b border-yellow-200">
			<span class="text-gray-600 truncate mr-2 flex items-center">${countryTag}${entry.description} ${originalInfo}</span>
			<span class="font-mono text-red-600 whitespace-nowrap">TWD ${Math.round(entry.amount)}</span>
		</div>
	`}).join('');

	infoDiv.innerHTML = `
		<div class="mb-3 text-center p-2 bg-yellow-100 rounded-lg">
			<p class="text-sm font-bold text-yellow-800">總支出:</p>
			<p class="text-base font-bold text-yellow-900">TWD ${Math.round(total)}</p>
		</div>
		<p class="text-sm font-semibold text-gray-700 mb-1">最新支出:</p>
		<div class="space-y-1">${listHtml}</div>
	`;
}

// --- Window Functions ---
window.navigateTo = (view, data) => { viewHistory.push(currentView); currentView = { name: view, data }; renderView(view, data); };
window.goBack = () => { if(viewHistory.length) { currentView = viewHistory.pop(); renderView(currentView.name, currentView.data); } else renderCountry(countries[0]); };
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
	if (!db || !userId) return alert('資料庫未連線');
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
		await addDoc(collection(db, `artifacts/${appId}/users/${userId}/budget_entries`), {
			description: desc, amount: amtTWD, originalAmount: rawAmt, originalCurrency: curr, timestamp: serverTimestamp(), country: currentCountryName || 'Global'
		});
		amtIn.value = ''; descIn.value = '';
	} catch (err) { console.error("新增失敗", err); alert('新增失敗'); }
};
window.handleFileUpload = (e) => {
	const file = e.target.files[0]; if(!file) return;
	const reader = new FileReader();
	reader.onload = (ev) => {
		try {
			const json = JSON.parse(ev.target.result);
			if(typeof json === 'object') {
				localStorage.setItem('customItineraryData', JSON.stringify(json));
				alert('匯入成功，請重新整理');
				location.reload();
			}
		} catch(err) { alert('JSON 格式錯誤'); }
	};
	reader.readAsText(file);
};
window.resetItinerary = () => { if(confirm('清除自訂行程?')) { localStorage.removeItem('customItineraryData'); location.reload(); } };

// --- 啟動 ---
async function init() {
	await loadItineraryData();
	if(auth) {
		onAuthStateChanged(auth, (u) => {
			isAuthReady = true; userId = u ? u.uid : null;
			if(!userId) signInAnonymously(auth).catch(console.error);
			if(currentView.name === 'home') renderCountry(countries[0]);
		});
	} else {
		renderCountry(countries[0]); // 離線模式渲染
	}
	fetchRealTimeRates();
}

document.addEventListener('DOMContentLoaded', init);
