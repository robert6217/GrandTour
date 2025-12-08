import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
	Globe, Plus, Briefcase, Calendar, DollarSign,
	Trash2, Plane, Sun, CloudRain, Cloud, Home,
	ChevronRight, ChevronLeft, Menu, X, Clock, MapPin,
	Phone, Building, Utensils, Camera, Bus, Bed, ShoppingBag,
	Download, Upload, Database, Check, RefreshCw
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';

// --- Leaflet Import ---
import L from 'leaflet';

let firebaseConfig = {
	apiKey: "",
	authDomain: "",
	projectId: "",
	storageBucket: "",
	messagingSenderId: "",
	appId: ""
};

try {
	const storedConfig = typeof window !== 'undefined' ? localStorage.getItem('custom_firebase_config') : null;
	if (storedConfig) {
		try {
			firebaseConfig = JSON.parse(storedConfig);
			console.log("已載入自訂 Firebase 設定");
		} catch (e) {
			console.error("自訂設定檔解析失敗，將嘗試使用預設環境變數", e);
		}
	} else if (typeof __firebase_config !== 'undefined') {
		// 如果沒有自訂設定，則使用環境變數 (Fallback)
		firebaseConfig = JSON.parse(__firebase_config);
	}
} catch (e) {
	console.error("Firebase 設定初始化錯誤:", e);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app';

let db, auth;
let isFirebaseReady = false;

try {
	if (firebaseConfig.apiKey) {
		const app = initializeApp(firebaseConfig);
		auth = getAuth(app);
		db = getFirestore(app);
		isFirebaseReady = true;
	}
} catch (e) {
	console.error("Firebase Init Error:", e);
}

// Hook to manage expenses
const useExpenses = (tripId) => {
	const [expenses, setExpenses] = useState([]);
	const [user, setUser] = useState(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!isFirebaseReady) {
			setLoading(false);
			return;
		}
		const initAuth = async () => {
			try {
				if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
					await signInWithCustomToken(auth, __initial_auth_token);
				} else {
					await signInAnonymously(auth);
				}
			} catch (e) {
				console.error("Auth failed", e);
			}
		};
		initAuth();
		const unsub = onAuthStateChanged(auth, (u) => setUser(u));
		return () => unsub();
	}, []);

	useEffect(() => {
		if (!user || !db || !tripId) {
			if (!tripId) setExpenses([]);
			return;
		}
		const q = collection(db, 'artifacts', appId, 'users', user.uid, 'expenses');
		const unsub = onSnapshot(q, (snapshot) => {
			const allExpenses = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
			const tripExpenses = allExpenses.filter(e => e.tripId === tripId);
			setExpenses(tripExpenses);
			setLoading(false);
		}, (err) => {
			console.error("Expenses fetch error", err);
			setLoading(false);
		});
		return () => unsub();
	}, [user, tripId]);

	const addExpense = async (item, amount, category) => {
		if (!user || !db) return;
		await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'expenses'), {
			tripId, item, amount: Number(amount), category, createdAt: new Date().toISOString()
		});
	};

	const removeExpense = async (expenseId) => {
		if (!user || !db) return;
		await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'expenses', expenseId));
	};

	return { expenses, loading, addExpense, removeExpense, user };
};

// --- Utils ---
const generateId = () => Math.random().toString(36).substr(2, 9);

const getDatesInRange = (startDate, endDate) => {
	const dates = [];
	const currDate = new Date(startDate);
	const lastDate = new Date(endDate);
	let dayCount = 1;
	const weekDays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

	while (currDate <= lastDate) {
		dates.push({
			dateStr: currDate.toISOString().split('T')[0],
			displayDate: `${currDate.getMonth() + 1}/${currDate.getDate()}`,
			month: currDate.getMonth() + 1,
			date: currDate.getDate(),
			dayNum: `Day ${dayCount}`,
			weekday: weekDays[currDate.getDay()] // Add weekday info
		});
		currDate.setDate(currDate.getDate() + 1);
		dayCount++;
	}
	return dates;
};

// --- Weather Service ---
function getWeatherDesc(code) {
	if (code === undefined || code === null) return { icon: '🌡️', text: '未知' };
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

const fetchWeatherData = async (locationQuery) => {
	try {
		const cleanLocation = locationQuery.trim();
		// Create candidates: Full string, Last word (often city), First word
		const candidates = [
			cleanLocation,
			cleanLocation.split(' ').pop(),
			cleanLocation.split(' ')[0]
		].filter((item, index, self) => item && item.length > 0 && self.indexOf(item) === index);

		let geoData = null;

		// Try candidates sequentially
		for (const term of candidates) {
			try {
				const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1&language=zh&format=json`;
				const geoRes = await fetch(geoUrl);
				const data = await geoRes.json();
				if (data.results && data.results.length > 0) {
					geoData = data;
					break; // Found match
				}
			} catch (e) {
				console.warn(`Weather search failed for term: ${term}`);
			}
		}

		if (!geoData || !geoData.results || geoData.results.length === 0) return { notFound: true };

		const { latitude, longitude } = geoData.results[0];
		const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=auto`;
		const weatherRes = await fetch(weatherUrl);
		const weatherData = await weatherRes.json();
		if (weatherData.current_weather) {
			const desc = getWeatherDesc(weatherData.current_weather.weathercode);
			return {
				icon: desc.icon, text: desc.text, temp: weatherData.current_weather.temperature, isCurrent: true
			};
		} else {
			return { notFound: true };
		}
	} catch (error) {
		console.error("Fetch weather error:", error);
		return null;
	}
};

const getCurvePoints = (start, end) => {
	const lat1 = start.lat;
	const lng1 = start.lon;
	const lat2 = end.lat;
	const lng2 = end.lon;
	const dist = Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2));
	const arcHeight = Math.min(dist * 0.25, 20);
	const controlLat = (lat1 + lat2) / 2 + arcHeight;
	const controlLng = (lng1 + lng2) / 2;
	const points = [];
	for (let t = 0; t <= 1; t += 0.02) {
		const lat = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * controlLat + t * t * lat2;
		const lng = (1 - t) * (1 - t) * lng1 + 2 * (1 - t) * t * controlLng + t * t * lng2;
		points.push([lat, lng]);
	}
	return points;
};

const EventIcon = ({ type }) => {
	switch (type?.toLowerCase()) {
		case 'food': return <Utensils size={14} className="text-orange-500" />;
		case 'attraction': return <Camera size={14} className="text-purple-500" />;
		case 'transport': return <Bus size={14} className="text-blue-500" />;
		case 'stay': return <Bed size={14} className="text-indigo-500" />;
		case 'shopping': return <ShoppingBag size={14} className="text-pink-500" />;
		default: return <MapPin size={14} className="text-slate-400" />;
	}
};

const EventItem = ({ event, updateEvent, deleteEvent }) => {
	const textareaRef = useRef(null);

	// Auto-resize textarea
	useEffect(() => {
		if (textareaRef.current) {
			// Reset height to shrink if needed
			textareaRef.current.style.height = 'auto';
			// Set height to scrollHeight to fit content
			textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
		}
	}, [event.note]);

	return (
		<div className="relative pl-6 border-l-2 border-slate-200">
			<div className="absolute -left-[9px] top-0 w-4 h-4 bg-white rounded-full border-2 border-slate-300 shadow-sm flex items-center justify-center p-0.5">
				<div className="w-full h-full bg-slate-300 rounded-full"></div>
			</div>
			<div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 group hover:shadow-md transition-shadow">
				<div className="flex items-start gap-2 mb-2">
					<div className="text-sm font-bold font-mono text-slate-800 border border-transparent">{event.time}</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 mb-1">
							<div className="relative group/type shrink-0">
								<button className="p-1 rounded hover:bg-slate-100 text-slate-500"><EventIcon type={event.type} /></button>
								<div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 shadow-lg rounded-lg p-1 hidden group-hover/type:flex gap-1 z-10">{['food', 'attraction', 'transport', 'stay', 'shopping'].map(t => (<button key={t} onClick={() => updateEvent(event.id, 'type', t)} className={`p-1.5 rounded hover:bg-slate-100 ${event.type === t ? 'bg-blue-50' : ''}`} title={t}><EventIcon type={t} /></button>))}</div>
							</div>
							<input type="text" placeholder="地點名稱" className="flex-1 min-w-0 font-bold text-slate-800 bg-transparent focus:outline-none border-b border-transparent focus:border-slate-300 pb-0.5" value={event.location} onChange={(e) => updateEvent(event.id, 'location', e.target.value)} />
						</div>
						{/* UPDATED: Auto-resizing textarea */}
						<textarea
							ref={textareaRef}
							placeholder="備註、計畫..."
							className="w-full bg-transparent text-sm text-slate-500 focus:outline-none resize-none overflow-hidden"
							rows={1}
							value={event.note}
							onChange={(e) => updateEvent(event.id, 'note', e.target.value)}
						/>
					</div>
					<button onClick={() => deleteEvent(event.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity p-1 shrink-0"><Trash2 size={16} /></button>
				</div>
			</div>
		</div>
	);
};

// --- Components ---

// 1. Map View (FIXED: Reliable updates)
const MapView = ({ trips, onSelectTrip }) => {
	const mapContainerRef = useRef(null);
	const mapInstanceRef = useRef(null);
	const [leafletLoaded, setLeafletLoaded] = useState(false);
	const [tripCoords, setTripCoords] = useState([]);
	const [mapReady, setMapReady] = useState(false);

	// Load Leaflet
	useEffect(() => {
		const existingScript = document.getElementById('leaflet-script');
		if (window.L && window.L.map) { setLeafletLoaded(true); return; }
		if (!document.getElementById('leaflet-style')) {
			const link = document.createElement('link');
			link.id = 'leaflet-style'; link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
			document.head.appendChild(link);
		}
		if (!existingScript) {
			const script = document.createElement('script');
			script.id = 'leaflet-script'; script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
			script.onload = () => { if (window.L && window.L.map) setLeafletLoaded(true); };
			document.head.appendChild(script);
		} else {
			if (window.L && window.L.map) setLeafletLoaded(true);
			else existingScript.addEventListener('load', () => { if (window.L && window.L.map) setLeafletLoaded(true); });
		}
	}, []);

	// Fetch Coords (Run whenever 'trips' changes)
	useEffect(() => {
		const fetchCoords = async () => {
			// Sort by start date for logical flight paths
			const sortedTrips = [...trips].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
			const coords = [];
			for (const trip of sortedTrips) {
				const searchTerms = [trip.country.trim(), trip.country.split(' ').pop(), trip.country.split(' ')[0]];
				let found = false;
				for (const term of searchTerms) {
					if (!term || found) continue;
					try {
						const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1&language=en&format=json`;
						const res = await fetch(url);
						const data = await res.json();
						if (data.results && data.results.length > 0) {
							coords.push({ id: trip.id, name: trip.country, lat: data.results[0].latitude, lon: data.results[0].longitude, date: trip.startDate });
							found = true;
						}
					} catch (e) { }
				}
			}
			setTripCoords(coords);
		};

		// Always fetch, even if empty (to clear map)
		fetchCoords();
	}, [trips]);

	// Init Map
	useEffect(() => {
		if (!leafletLoaded || !mapContainerRef.current || mapInstanceRef.current) return;
		try {
			const L = window.L;
			const map = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false, minZoom: 2, maxBounds: [[-90, -180], [90, 180]] }).setView([20, 0], 2);
			L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap', subdomains: 'abcd', maxZoom: 19 }).addTo(map);
			L.control.zoom({ position: 'bottomright' }).addTo(map);
			mapInstanceRef.current = map;
			setMapReady(true);
		} catch (err) { }
		return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; setMapReady(false); } }
	}, [leafletLoaded]);

	// Update Markers (FIXED: Always clear layers first)
	useEffect(() => {
		if (!mapReady || !mapInstanceRef.current || !window.L) return;
		const L = window.L;
		const map = mapInstanceRef.current;

		// Create layer group if not exists
		if (!map.markerLayer) map.markerLayer = L.layerGroup().addTo(map);

		// 1. ALWAYS CLEAR OLD LAYERS
		map.markerLayer.clearLayers();

		// If no coords, stop here (map remains cleared)
		if (tripCoords.length === 0) return;

		const customIcon = L.divIcon({ className: 'custom-map-marker', html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); cursor: pointer;"></div>`, iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -10] });

		for (let i = 0; i < tripCoords.length - 1; i++) {
			const points = getCurvePoints(tripCoords[i], tripCoords[i + 1]);
			L.polyline(points, { color: '#3b82f6', weight: 2, opacity: 0.6, dashArray: '5, 10', lineCap: 'round' }).addTo(map.markerLayer);
		}

		tripCoords.forEach(c => {
			L.marker([c.lat, c.lon], { icon: customIcon })
				.addTo(map.markerLayer)
				.bindTooltip(`<div style="font-family:serif; font-weight:bold;">${c.name}</div>`, { direction: 'top', offset: [0, -10] })
				.on('click', () => onSelectTrip(c.id));
		});

		try {
			const group = new L.featureGroup(tripCoords.map(c => L.marker([c.lat, c.lon])));
			if (group.getBounds().isValid()) map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 4, padding: [50, 50] });
		} catch (e) { }
	}, [tripCoords, mapReady]);

	return (
		<div className="relative w-full h-full flex flex-col font-serif">
			<div ref={mapContainerRef} className="absolute inset-0 z-0 bg-slate-100" />
			<div className="z-10 p-6 pt-12 flex flex-col h-full pointer-events-none">
				<h1 className="text-3xl font-bold text-slate-800 mb-2 text-center drop-shadow-sm tracking-widest bg-white/60 backdrop-blur-sm py-2 rounded-xl border border-white/40 self-center px-8 shadow-sm">一路向西<p>直到世界盡頭</p></h1>
				{trips.length === 0 && (
					<div className="flex-1 flex items-center justify-center">
						<div className="bg-white/80 backdrop-blur-md border border-white/50 p-8 rounded-xl text-center shadow-sm pointer-events-auto">
							<div className="text-slate-500 mb-2">目前沒有行程</div>
							<div className="text-xs text-slate-400">請點擊左側上傳按鈕匯入行程表，或新增一個國家。</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

// 2. Toolbox View
const ToolboxView = ({ trip }) => {
	const tools = trip.tools || {};
	const embassy = trip.embassy || {};
	const accommodation = trip.accommodation || {};
	const [exchangeRate, setExchangeRate] = useState(null);
	const [loadingRate, setLoadingRate] = useState(false);

	useEffect(() => {
		if (!tools.currency) return;
		const fetchRate = async () => {
			setLoadingRate(true);
			try {
				const response = await fetch('https://api.exchangerate-api.com/v4/latest/TWD');
				if (!response.ok) throw new Error('Network response was not ok');
				const data = await response.json();
				const rate = data.rates[tools.currency.toUpperCase()];
				setExchangeRate(rate);
			} catch (e) {
				console.error("Exchange rate fetch error", e);
				setExchangeRate(null);
			} finally {
				setLoadingRate(false);
			}
		};
		fetchRate();
	}, [tools.currency]);

	return (
		<div className="space-y-4 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div className="bg-red-50 border border-red-100 p-4 rounded-xl">
					<h4 className="font-bold text-red-800 flex items-center gap-2 mb-3"><div className="p-1 bg-red-100 rounded-lg"><Phone size={16} /></div>緊急救援</h4>
					<div className="space-y-2 text-sm text-red-700">
						<div className="space-y-1 text-sm text-red-700"><p><strong>報警:</strong> <span className="font-bold text-red-600 text-lg">{tools.emergency || '999'}</span></p></div>
						<div className="mt-3 pt-3 border-t border-red-100"><p className="font-bold text-sm text-red-900 mb-1">大使館 / 代表處</p>
							<div className="font-bold text-base text-gray-800">
								<div className="font-bold">{embassy.name || '未設定'}</div>
								<div className="flex gap-2 items-center opacity-80"><Phone size={14} />
									<span className="font-mono">{embassy.phone || '無電話'}</span>
								</div>
								<div className="font-bold"><button onClick={() => window.open(embassy.gmaps_url, '_blank')} className="mt-2 w-full py-1.5 bg-red-600 text-white rounded text-xs font-bold">導航</button></div>
							</div>
						</div>
					</div>
				</div>
				<div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
					<h4 className="font-bold text-emerald-800 flex items-center gap-2 mb-3"><div className="p-1 bg-emerald-100 rounded-lg"><Home size={16} /></div>住宿資訊</h4>
					<div className="text-sm text-emerald-900 space-y-3">
						<div className="flex justify-between items-center"><div className="font-bold text-lg">{accommodation.name || '未設定飯店'}</div></div>

						<div className="grid grid-cols-2 gap-4 bg-white/50 p-2 rounded-lg"><div className="text-center"><div className="text-xs opacity-60">Check-in</div><div className="font-mono font-bold">{accommodation.checkIn}</div></div><div className="text-center"><div className="text-xs opacity-60">Check-out</div><div className="font-mono font-bold">{accommodation.checkOut}</div></div></div>
						{accommodation.note && (<div className="text-xs bg-emerald-100/50 p-2 rounded text-emerald-800 border-l-2 border-emerald-300">{accommodation.note}</div>)}
						<button onClick={() => window.open(accommodation.gmaps_url, '_blank')} className="mt-2 w-full py-1.5 bg-emerald-600 text-white rounded text-xs font-bold">導航</button>
					</div>
				</div>
				<div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
					<h4 className="font-bold text-blue-800 flex items-center gap-2 mb-3"><div className="p-1 bg-blue-100 rounded-lg"><Plane size={16} /></div>航班資訊</h4>
					<div className="text-sm text-blue-900 space-y-3">

					</div>
				</div>
				<div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
					<h4 className="font-bold text-slate-700 flex items-center gap-2 mb-3"><div className="p-1 bg-slate-200 rounded-lg"><DollarSign size={16} /></div>基本資訊</h4>
					<div className="grid grid-cols-2 gap-4">
						<div><div className="text-xs text-slate-400">當地貨幣</div><div className="font-bold text-slate-800">{tools.currency || '未知'}</div></div>
						<div><div className="text-xs text-slate-400">時區</div><div className="font-bold text-slate-800">{tools.timezone || 'UTC'}</div></div>
						{tools.currency && (
							<div className="col-span-2 mt-2 pt-2 border-t border-slate-200">
								<div className="flex items-center justify-between">
									<div className="text-xs text-slate-400">即時匯率 (TWD Base)</div>
									{loadingRate && <RefreshCw size={12} className="animate-spin text-slate-400" />}
								</div>
								{exchangeRate ? (
									<div className="mt-1">
										<div className="flex justify-between items-baseline">
											<span className="text-sm text-slate-500">1 TWD ≈</span>
											<span className="font-mono font-bold text-emerald-600 text-lg">{exchangeRate} {tools.currency}</span>
										</div>
										<div className="flex justify-between items-baseline mt-1">
											<span className="text-sm text-slate-500">1 {tools.currency} ≈</span>
											<span className="font-mono font-bold text-emerald-600 text-sm">{(1/exchangeRate).toFixed(3)} TWD</span>
										</div>
										<div className="text-[10px] text-right text-slate-300 mt-1">Source: ExchangeRate-API</div>
									</div>
								) : (
									<div className="text-xs text-red-400 mt-1">無法取得匯率資訊</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};

// 3. Trip Detail View
const TripDetailView = ({ trip, onUpdateTrip, onDeleteTrip }) => {
	const [selectedDateStr, setSelectedDateStr] = useState(trip.startDate);
	const [subView, setSubView] = useState('itinerary');
	const [weatherInfo, setWeatherInfo] = useState(null);
	const [loadingWeather, setLoadingWeather] = useState(false);

	const dates = useMemo(() => getDatesInRange(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
	const currentDayData = trip.days?.[selectedDateStr] || { flight: null, events: [], weather: 'sunny' };

	useEffect(() => {
		let isMounted = true;
		const loadWeather = async () => {
			setLoadingWeather(true); setWeatherInfo(null);
			const data = await fetchWeatherData(trip.country);
			if (isMounted) { setWeatherInfo(data); setLoadingWeather(false); }
		};
		if (trip.country) loadWeather();
		return () => { isMounted = false; };
	}, [trip.country]);

	// Handlers
	const addEvent = () => {
		const newEvent = { id: generateId(), time: '12:00', location: '', note: '', type: 'attraction' };
		const updatedTrip = { ...trip, days: { ...trip.days, [selectedDateStr]: { ...currentDayData, events: [...(currentDayData.events || []), newEvent] } } };
		onUpdateTrip(updatedTrip);
	};
	const updateEvent = (eventId, field, value) => {
		const updatedEvents = currentDayData.events.map(ev => ev.id === eventId ? { ...ev, [field]: value } : ev);
		const updatedTrip = { ...trip, days: { ...trip.days, [selectedDateStr]: { ...currentDayData, events: updatedEvents } } };
		onUpdateTrip(updatedTrip);
	};
	const deleteEvent = (eventId) => {
		const updatedEvents = currentDayData.events.filter(ev => ev.id !== eventId);
		const updatedTrip = { ...trip, days: { ...trip.days, [selectedDateStr]: { ...currentDayData, events: updatedEvents } } };
		onUpdateTrip(updatedTrip);
	};

	const renderDayList = () => (
		<div className="space-y-4 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
			{/* Weather Widget Moved Here */}
			<div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center justify-between shadow-sm mb-4">
				<div className="flex items-center gap-3 flex-1 min-w-0">
					<div className="bg-white p-2 rounded-full shadow-sm text-blue-500">
						{loadingWeather ? <Cloud className="animate-pulse" size={20} /> : <span className="text-2xl">{weatherInfo?.icon || '🌡️'}</span>}
					</div>
					<div>
						<h3 className="font-bold text-slate-800 text-sm opacity-60">當地天氣</h3>
						<div className="text-blue-900 font-bold">
							{loadingWeather ? '讀取中...' : (weatherInfo && !weatherInfo.notFound) ? `${weatherInfo.temp}°C ${weatherInfo.text}` : '無法取得資訊'}
						</div>
					</div>
				</div>
				<div className="text-right">
					<div className="text-blue-300 text-xs">Open-Meteo</div>
				</div>
			</div>

			<h3 className="font-bold text-slate-800 text-lg mb-2 px-1">行程總覽</h3>
			{dates.map((d) => {
				// Calculate event summary for preview
				const dayEvents = trip.days?.[d.dateStr]?.events || [];
				const eventPreview = dayEvents.length > 0
					? dayEvents.map(e => e.location || e.item || '行程').slice(0, 2).join(' · ') + (dayEvents.length > 2 ? '...' : '')
					: '點擊新增行程...';

				return (
					<div
						key={d.dateStr}
						onClick={() => setSelectedDateStr(d.dateStr)}
						className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between cursor-pointer hover:shadow-md transition-all active:scale-[0.98] group"
					>
						<div className="flex items-center gap-4 flex-1 overflow-hidden">
							{/* Date Box: Enhanced Visuals */}
							<div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl p-2 w-16 h-16 flex flex-col items-center justify-center shadow-md shadow-blue-200 shrink-0">
								<span className="text-[10px] font-bold opacity-80 uppercase">{d.month}月</span>
								<span className="text-2xl font-serif font-bold leading-none">{d.date}</span>
							</div>

							{/* Text Info: Replaced redundant date with Weekday and Preview */}
							<div className="flex-1 min-w-0">
								<div className="flex items-baseline gap-2 mb-1">
									<div className="font-bold text-slate-800 text-lg font-serif">{d.dayNum}</div>
									<div className="text-sm font-bold text-slate-400 border-l border-slate-300 pl-2">{d.weekday}</div>
								</div>
								<div className={`text-sm truncate font-serif ${dayEvents.length > 0 ? 'text-slate-600' : 'text-slate-300 italic'}`}>
									{eventPreview}
								</div>
							</div>
						</div>
						<div className="pl-2">
							<ChevronRight className="text-slate-300 group-hover:text-blue-500 transition-colors" />
						</div>
					</div>
				);
			})}
		</div>
	);

	const renderItinerary = () => (
		<div className="space-y-6 pb-24 animate-in fade-in slide-in-from-right-4 duration-300 font-serif">
			<div className="flex items-center gap-2 mb-2 sticky top-0 bg-slate-50 py-2 z-10">
				<button onClick={() => setSelectedDateStr(null)} className="flex items-center gap-1 text-slate-500 hover:text-blue-600 hover:bg-slate-100 pr-3 pl-1 py-1.5 rounded-lg transition-colors">
					<ChevronLeft size={20} />
					<span className="text-sm font-bold">返回列表</span>
				</button>
			</div>

			<div>
				<div className="flex justify-between items-center mb-4"><h4 className="font-bold text-slate-700">每日行程</h4><button onClick={addEvent} className="flex items-center gap-1 text-sm text-blue-600 font-medium hover:text-blue-700"><Plus size={16} /> 新增</button></div>
				<div className="space-y-4">
					{(currentDayData.events || []).map((event) => (
						<EventItem
							key={event.id}
							event={event}
							updateEvent={updateEvent}
							deleteEvent={deleteEvent}
						/>
					))}
					{(!currentDayData.events || currentDayData.events.length === 0) && (<div className="text-center py-8 text-slate-400 italic text-sm">點擊上方新增按鈕開始規劃行程</div>)}
				</div>
			</div>
		</div>
	);

	return (
		<div className="flex flex-col h-full bg-slate-50 font-serif">
			<div className="bg-white px-4 py-3 shadow-sm border-b border-slate-200 sticky top-0 z-20 flex justify-between items-center">
				<h2 className="text-lg font-bold text-slate-800 truncate max-w-[50%] tracking-wide">{trip.country}</h2>
				<div className="flex gap-1">
					<button onClick={() => setSubView('itinerary')} className={`p-2 rounded-lg transition-colors ${subView === 'itinerary' ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:bg-slate-100'}`}><Calendar size={20} /></button>
					<button onClick={() => setSubView('toolbox')} className={`p-2 rounded-lg transition-colors ${subView === 'toolbox' ? 'bg-orange-100 text-orange-600' : 'text-slate-400 hover:bg-slate-100'}`}><Briefcase size={20} /></button>
					<button onClick={() => setSubView('expense')} className={`p-2 rounded-lg transition-colors ${subView === 'expense' ? 'bg-emerald-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-100'}`}><DollarSign size={20} /></button>
					<button onClick={() => { if (window.confirm('確定要刪除此國家行程嗎？')) onDeleteTrip(trip.id); }} className="p-2 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors ml-2"><Trash2 size={20} /></button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-4">
				{subView === 'itinerary' && (
					!selectedDateStr ? renderDayList() : renderItinerary()
				)}
				{subView === 'toolbox' && <ToolboxView trip={trip} />}
				{subView === 'expense' && <ExpenseView trip={trip} />}
			</div>
		</div>
	);
};

// 4. Expense View
const ExpenseView = ({ trip }) => {
	const { expenses, loading, addExpense, removeExpense, user } = useExpenses(trip?.id);
	const total = expenses.reduce((s, e) => s + e.amount, 0);
	const [deletingId, setDeletingId] = useState(null);
	const [isTimeout, setIsTimeout] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setIsTimeout(true), 3000);
		return () => clearTimeout(timer);
	}, []);

	const handleDeleteClick = (id) => {
		setDeletingId(id);
	};

	const confirmDelete = async (id) => {
		await removeExpense(id);
		setDeletingId(null);
	};

	const cancelDelete = () => {
		setDeletingId(null);
	};

	if (!user) {
		return (
			<div className="p-10 text-center text-slate-400">
				{isTimeout ? (
					<div className="flex flex-col items-center gap-2">
						<span>尚無資料庫連線</span>
						<span className="text-xs">請點擊首頁左側「匯入資料庫設定」以啟用雲端記帳功能</span>
					</div>
				) : (
					<span className="animate-pulse">正在連接記帳資料庫...</span>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-4 pb-24 animate-in fade-in duration-300 font-serif">
			{/* Total Summary Card */}
			<div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-6 rounded-2xl shadow-lg shadow-emerald-200 mb-6 relative overflow-hidden">
				<div className="relative z-10">
					<div className="text-emerald-100 text-sm mb-1 font-medium tracking-wider flex items-center gap-2">
						<DollarSign size={16} /> 本行程總支出
					</div>
					<div className="text-4xl font-bold tracking-widest font-mono">
						${total.toLocaleString()}
					</div>
				</div>
				<div className="absolute right-0 bottom-0 opacity-10 transform translate-x-4 translate-y-4">
					<DollarSign size={120} />
				</div>
			</div>

			{/* Add Expense Form */}
			<form
				className="bg-white p-4 rounded-xl shadow-sm border border-slate-100"
				onSubmit={(e) => {
					e.preventDefault();
					const fd = new FormData(e.target);
					const item = fd.get('item');
					const amount = fd.get('amount');
					if (item && amount) {
						addExpense(item, amount, 'General');
						e.target.reset();
					}
				}}
			>
				<h4 className="font-bold text-slate-700 mb-3 text-sm flex items-center gap-2">
					<Plus size={16} className="text-emerald-600" /> 新增消費
				</h4>
				<div className="flex gap-3 mb-3">
					<input
						name="item"
						required
						placeholder="項目 (e.g. 晚餐)"
						className="flex-1 bg-slate-50 p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all min-w-0"
					/>
					<input
						name="amount"
						required
						type="number"
						placeholder="$"
						className="w-24 bg-slate-50 p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-mono min-w-0"
					/>
				</div>
				<button
					type="submit"
					className="w-full bg-slate-800 text-white py-3 rounded-xl text-sm font-bold hover:bg-slate-900 transition-all active:scale-[0.98] shadow-md shadow-slate-200"
				>
					記一筆
				</button>
			</form>

			{/* Expense List */}
			<div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
				<div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
					<span className="font-bold text-slate-700 text-sm">消費明細</span>
					{loading && <span className="text-xs text-slate-400 animate-pulse">同步中...</span>}
				</div>

				<div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
					{expenses.length === 0 && !loading ? (
						<div className="p-10 text-center text-slate-400 text-sm italic flex flex-col items-center gap-2">
							<ShoppingBag size={32} className="opacity-20" />
							<span>暫無消費資料</span>
						</div>
					) : (
						expenses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(exp => (
							<div key={exp.id} className="p-4 flex justify-between items-center group hover:bg-slate-50 transition-colors">
								<div className="flex items-center gap-3">
									<div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
										<DollarSign size={14} />
									</div>
									<div>
										<div className="font-bold text-slate-800 text-sm">{exp.item}</div>
										<div className="text-[10px] text-slate-400">
											{exp.createdAt ? new Date(exp.createdAt).toLocaleDateString() : '剛剛'}
										</div>
									</div>
								</div>
								<div className="flex items-center gap-4">
									<span className="font-mono font-bold text-slate-700 text-base">
										${exp.amount.toLocaleString()}
									</span>

									{/* Inline Delete Confirmation */}
									{deletingId === exp.id ? (
										<div className="flex gap-1 animate-in fade-in slide-in-from-right-4 duration-200">
											<button
												onClick={() => confirmDelete(exp.id)}
												className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-600 transition-all shadow-sm"
												title="確認刪除"
											>
												<Check size={16} />
											</button>
											<button
												onClick={cancelDelete}
												className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all"
												title="取消"
											>
												<X size={16} />
											</button>
										</div>
									) : (
										<button
											onClick={() => handleDeleteClick(exp.id)}
											className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
											title="刪除"
										>
											<Trash2 size={16} />
										</button>
									)}
								</div>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
};

// 5. Global Expense View
const GlobalExpenseView = ({ trips }) => {
	const [allExpenses, setAllExpenses] = useState([]);
	const [loading, setLoading] = useState(true);
	const [user, setUser] = useState(null);

	useEffect(() => {
		if (!isFirebaseReady) return;
		const unsubAuth = onAuthStateChanged(auth, u => setUser(u));
		return () => unsubAuth();
	}, []);

	useEffect(() => {
		if (!user || !db) return;
		const q = collection(db, 'artifacts', appId, 'users', user.uid, 'expenses');
		const unsub = onSnapshot(q, (snap) => {
			const data = snap.docs.map(d => d.data());
			setAllExpenses(data);
			setLoading(false);
		});
		return () => unsub();
	}, [user]);

	const total = allExpenses.reduce((s, e) => s + Number(e.amount), 0);

	return (
		<div className="p-6 bg-slate-50 min-h-full pb-24 font-serif">
			<h2 className="text-2xl font-bold text-slate-800 mb-6">總帳本</h2>
			<div className="bg-slate-800 text-white p-6 rounded-2xl shadow-xl mb-8"><div className="text-slate-300 mb-1">所有旅程總支出 (雲端)</div><div className="text-4xl font-bold tracking-widest">${total.toLocaleString()}</div></div>
			<div className="space-y-4">
				{trips.map(trip => {
					const tripTotal = allExpenses.filter(e => e.tripId === trip.id).reduce((s, e) => s + Number(e.amount), 0);
					return (
						<div key={trip.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center"><div><div className="font-bold text-slate-800">{trip.country}</div><div className="text-xs text-slate-500">{trip.startDate}</div></div><div className="font-mono font-bold text-emerald-600">${tripTotal.toLocaleString()}</div></div>
					);
				})}
			</div>
		</div>
	);
};

// 6. AddTripModal (Added back)
const AddTripModal = ({ onClose, onAdd }) => {
	const [country, setCountry] = useState('');
	const [start, setStart] = useState('');
	const [end, setEnd] = useState('');

	const handleSubmit = (e) => {
		e.preventDefault();
		if (!country || !start || !end) return;
		onAdd({ country, startDate: start, endDate: end });
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-serif">
			<div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
				<div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold text-slate-800">新增旅遊行程</h2><button onClick={onClose}><X className="text-slate-400 hover:text-slate-800" /></button></div>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div><label className="block text-sm font-medium text-slate-600 mb-1">國家 / 標題</label><input type="text" placeholder="例如：法國 Paris" className="w-full border border-slate-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500" value={country} onChange={e => setCountry(e.target.value)} /></div>
					<div className="grid grid-cols-2 gap-4">
						<div><label className="block text-sm font-medium text-slate-600 mb-1">開始日期</label><input type="date" className="w-full border border-slate-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500" value={start} onChange={e => setStart(e.target.value)} /></div>
						<div><label className="block text-sm font-medium text-slate-600 mb-1">結束日期</label><input type="date" className="w-full border border-slate-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500" value={end} onChange={e => setEnd(e.target.value)} /></div>
					</div>
					<button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors mt-4 shadow-lg shadow-blue-200">建立行程</button>
				</form>
			</div>
		</div>
	);
};

// --- Main App Container ---

const App = () => {
	const [trips, setTrips] = useState(() => {
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem('my_travel_logs');
			if (saved) {
				try {
					const parsed = JSON.parse(saved);
					if (Array.isArray(parsed) && parsed.length > 0) {
						return parsed;
					}
				} catch (e) {
					console.error("Failed to parse saved trips", e);
				}
			}
		}
		return [];
	});
	const [view, setView] = useState('home');
	const [activeTripId, setActiveTripId] = useState(null);
	const [isSidebarOpen, setSidebarOpen] = useState(false);
	const fileInputRef = useRef(null);
	const firebaseConfigInputRef = useRef(null);

	useEffect(() => { localStorage.setItem('my_travel_logs', JSON.stringify(trips)); }, [trips]);

	const handleAddTrip = (newTripData) => {
		const newTrip = { id: generateId(), country: newTripData.country, startDate: newTripData.startDate, endDate: newTripData.endDate, days: {} };
		setTrips([...trips, newTrip]); setActiveTripId(newTrip.id); setView('trip');
	};
	const handleUpdateTrip = (updatedTrip) => { setTrips(trips.map(t => t.id === updatedTrip.id ? updatedTrip : t)); };
	const handleDeleteTrip = (id) => { setTrips(trips.filter(t => t.id !== id)); setView('home'); setActiveTripId(null); };

	const handleDownload = () => {
		const dataStr = JSON.stringify(trips, null, 2);
		const blob = new Blob([dataStr], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.download = `travel_log_backup_${new Date().toISOString().split('T')[0]}.json`;
		link.href = url;
		link.click();
	};

	const handleUploadClick = () => { fileInputRef.current.click(); };

	const handleFileChange = (e) => {
		const file = e.target.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (event) => {
			try {
				const importedData = JSON.parse(event.target.result);
				if (Array.isArray(importedData)) { setTrips(importedData); alert("行程匯入成功！"); } else { alert("檔案格式錯誤：必須是行程陣列"); }
			} catch (error) { console.error(error); alert("無法讀取檔案，請確認是有效的 JSON 檔"); }
		};
		reader.readAsText(file);
		e.target.value = '';
	};

	const handleFirebaseConfigUpload = () => {
		firebaseConfigInputRef.current.click();
	};

	const handleFirebaseConfigFileChange = (e) => {
		const file = e.target.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (event) => {
			try {
				const config = JSON.parse(event.target.result);
				// 基本驗證：檢查是否有 apiKey
				if (!config.apiKey) {
					alert("設定檔無效：缺少 apiKey 欄位");
					return;
				}
				localStorage.setItem('custom_firebase_config', JSON.stringify(config));
				alert("Firebase 設定已匯入！網頁將重新整理以套用新設定。");
				window.location.reload();
			} catch (error) {
				console.error(error);
				alert("無法讀取設定檔，請確認是有效的 JSON 檔");
			}
		};
		reader.readAsText(file);
		e.target.value = '';
	};

	const activeTrip = trips.find(t => t.id === activeTripId);

	return (
		<>
			<div className="flex h-screen w-full overflow-hidden font-serif text-slate-800 bg-slate-50">
				<div className={`fixed md:relative z-40 h-full w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
					<div className="p-4 h-full flex flex-col">
						<div className="flex items-center justify-between mb-8"><h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-widest">蘿蔔30之旅</h1><button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400"><X /></button></div>
						<div className="flex-1 overflow-y-auto space-y-2">
							<button onClick={() => { setView('home'); setSidebarOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-4 ${view === 'home' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}><Globe size={18} />世界地圖 (首頁)</button>
							<div className="mb-4 space-y-2 border-b border-slate-100 pb-4">
								<div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2">Data Management</div>
								<button onClick={handleDownload} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"><Download size={16} /> 下載行程 (JSON)</button>
								<button onClick={handleUploadClick} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"><Upload size={16} /> 匯入行程</button>
								<button onClick={handleFirebaseConfigUpload} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"><Database size={16} /> 設定資料庫</button>
								<input type="file" ref={firebaseConfigInputRef} onChange={handleFirebaseConfigFileChange} className="hidden" accept=".json" />
							</div>
							<div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">My Trips</div>
							{trips.map(trip => (<button key={trip.id} onClick={() => { setActiveTripId(trip.id); setView('trip'); setSidebarOpen(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTripId === trip.id && view === 'trip' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>{trip.country}</button>))}
						</div>
						<div className="mt-auto pt-4 border-t border-slate-100 hidden md:block"><button onClick={() => setView('global_expense')} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'global_expense' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-600 hover:bg-slate-50'}`}><DollarSign size={18} /> 總帳本</button></div>
					</div>
				</div>
				{isSidebarOpen && (<div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />)}
				<div className="flex-1 flex flex-col h-full relative">
					<div className="md:hidden absolute top-4 left-4 z-20"><button onClick={() => setSidebarOpen(true)} className="p-2 bg-white/80 backdrop-blur rounded-full shadow-sm text-slate-700"><Menu size={20} /></button></div>
					<main className="flex-1 overflow-hidden relative">
						{view === 'home' && (<MapView trips={trips} onSelectTrip={(id) => { setActiveTripId(id); setView('trip'); }} />)}
						{view === 'trip' && activeTrip && (<TripDetailView trip={activeTrip} onUpdateTrip={handleUpdateTrip} onDeleteTrip={handleDeleteTrip} />)}
						{view === 'global_expense' && (<GlobalExpenseView trips={trips} />)}
					</main>
					<div className="bg-white border-t border-slate-200 h-16 flex justify-around items-center px-6 md:hidden z-30 pb-safe">
						<button onClick={() => setView('home')} className={`flex flex-col items-center gap-1 ${view === 'home' ? 'text-blue-600' : 'text-slate-400'}`}><Home size={22} /><span className="text-[10px] font-medium">首頁</span></button>
						<button onClick={() => setView('global_expense')} className={`flex flex-col items-center gap-1 ${view === 'global_expense' ? 'text-blue-600' : 'text-slate-400'}`}><DollarSign size={22} /><span className="text-[10px] font-medium">總帳</span></button>
					</div>
				</div>
			</div>
		</>
	);
};

export default App;