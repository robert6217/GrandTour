import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
	Globe, Plus, Briefcase, Calendar, DollarSign,
	Trash2, Plane, Sun, CloudRain, Cloud, Home,
	ChevronRight, Menu, X, Clock, MapPin,
	Phone, Building, Utensils, Camera, Bus, Bed, ShoppingBag,
	Download, Upload
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';

// --- Leaflet Import ---
import L from 'leaflet';

// --- Firebase Init ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
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
	while (currDate <= lastDate) {
		dates.push({
			dateStr: currDate.toISOString().split('T')[0],
			displayDate: `${currDate.getMonth() + 1}/${currDate.getDate()}`,
			dayNum: `Day ${dayCount}`
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
		const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanLocation)}&count=1&language=zh&format=json`;
		const geoRes = await fetch(geoUrl);
		const geoData = await geoRes.json();
		if (!geoData.results || geoData.results.length === 0) return null;
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
				<h1 className="text-3xl font-bold text-slate-800 mb-2 text-center drop-shadow-sm tracking-widest bg-white/60 backdrop-blur-sm py-2 rounded-xl border border-white/40 self-center px-8 shadow-sm">My World Travel</h1>
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

	return (
		<div className="space-y-4 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div className="bg-red-50 border border-red-100 p-4 rounded-xl">
					<h4 className="font-bold text-red-800 flex items-center gap-2 mb-3"><div className="p-1 bg-red-100 rounded-lg"><Phone size={16} /></div>緊急聯絡</h4>
					<div className="space-y-2 text-sm text-red-700">
						<div className="flex justify-between border-b border-red-100 pb-1"><span>報警/救護</span><span className="font-mono font-bold text-lg">{tools.emergency || '112'}</span></div>
						<div className="text-xs opacity-70">遇到緊急狀況請保持冷靜並撥打上述電話。</div>
					</div>
				</div>
				<div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
					<h4 className="font-bold text-slate-700 flex items-center gap-2 mb-3"><div className="p-1 bg-slate-200 rounded-lg"><DollarSign size={16} /></div>基本資訊</h4>
					<div className="grid grid-cols-2 gap-4">
						<div><div className="text-xs text-slate-400">當地貨幣</div><div className="font-bold text-slate-800">{tools.currency || '未知'}</div></div>
						<div><div className="text-xs text-slate-400">時區</div><div className="font-bold text-slate-800">{tools.timezone || 'UTC'}</div></div>
					</div>
				</div>
			</div>
			<div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
				<h4 className="font-bold text-blue-800 flex items-center gap-2 mb-3"><div className="p-1 bg-blue-100 rounded-lg"><Building size={16} /></div>大使館 / 代表處</h4>
				<div className="text-sm text-blue-900 space-y-2"><div className="font-bold">{embassy.name || '未設定'}</div><div className="flex gap-2 items-start opacity-80"><MapPin size={14} className="mt-0.5 shrink-0" /><span>{embassy.address || '無地址資訊'}</span></div><div className="flex gap-2 items-center opacity-80"><Phone size={14} /><span className="font-mono">{embassy.phone || '無電話'}</span></div></div>
			</div>
			<div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
				<h4 className="font-bold text-emerald-800 flex items-center gap-2 mb-3"><div className="p-1 bg-emerald-100 rounded-lg"><Home size={16} /></div>住宿資訊</h4>
				<div className="text-sm text-emerald-900 space-y-3">
					<div className="flex justify-between items-center"><div className="font-bold text-lg">{accommodation.name || '未設定飯店'}</div></div>
					<a href={accommodation.gmaps_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full bg-emerald-600 text-white py-3 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm font-bold"><MapPin size={18} />導航至飯店 (Google Maps)</a>
					<div className="grid grid-cols-2 gap-4 bg-white/50 p-2 rounded-lg"><div className="text-center"><div className="text-xs opacity-60">Check-in</div><div className="font-mono font-bold">{accommodation.checkIn}</div></div><div className="text-center"><div className="text-xs opacity-60">Check-out</div><div className="font-mono font-bold">{accommodation.checkOut}</div></div></div>
					{accommodation.note && (<div className="text-xs bg-emerald-100/50 p-2 rounded text-emerald-800 border-l-2 border-emerald-300">{accommodation.note}</div>)}
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
	const toggleFlight = () => {
		const newFlight = currentDayData.flight ? null : { code: '', depTime: '08:00', arrTime: '12:00', from: '', to: '' };
		const updatedTrip = { ...trip, days: { ...trip.days, [selectedDateStr]: { ...currentDayData, flight: newFlight } } };
		onUpdateTrip(updatedTrip);
	};
	const updateFlight = (field, value) => {
		if (!currentDayData.flight) return;
		const updatedTrip = { ...trip, days: { ...trip.days, [selectedDateStr]: { ...currentDayData, flight: { ...currentDayData.flight, [field]: value } } } };
		onUpdateTrip(updatedTrip);
	};
	const handleExtendTrip = () => {
		const currentEndDate = new Date(trip.endDate); currentEndDate.setDate(currentEndDate.getDate() + 1);
		onUpdateTrip({ ...trip, endDate: currentEndDate.toISOString().split('T')[0] });
	};

	const renderItinerary = () => (
		<div className="space-y-6 pb-24 animate-in fade-in duration-300 font-serif">
			<div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-100">
				<div className="flex items-center gap-3"><div className="bg-blue-100 text-blue-600 p-2 rounded-lg"><Calendar size={20} /></div><div><h3 className="font-bold text-slate-800 text-lg">{dates.find(d => d.dateStr === selectedDateStr)?.displayDate}</h3><span className="text-xs text-slate-500">{dates.find(d => d.dateStr === selectedDateStr)?.dayNum}</span></div></div>
				<div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 min-w-[140px] justify-center relative group">
					{loadingWeather ? <span className="text-xs text-slate-400 animate-pulse">載入中...</span> : weatherInfo && !weatherInfo.notFound ? <><div className="flex flex-col items-center justify-center"><span className="text-xl leading-none mb-1 drop-shadow-sm">{String(weatherInfo.icon)}</span><span className="text-[10px] text-slate-500 font-medium">{String(weatherInfo.text)}</span></div><div className="h-8 w-px bg-slate-200 mx-2"></div><div className="flex items-center text-lg font-bold text-slate-700">{weatherInfo.temp}°C</div></> : <span className="text-xs text-slate-400">無訊號</span>}
				</div>
			</div>

			<div className="relative">
				{!currentDayData.flight && (<button onClick={toggleFlight} className="w-full py-4 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 transition-all flex items-center justify-center gap-2 font-medium"><Plane size={20} /> 新增航班資訊</button>)}
				{currentDayData.flight && (
					<div className="bg-white rounded-2xl shadow-md overflow-hidden border border-slate-200">
						<div className="h-2 w-full bg-indigo-500"></div>
						<div className="p-5">
							<div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4"><div className="flex items-center gap-3"><div className="bg-indigo-100 p-2 rounded-full text-indigo-600"><Plane size={20} /></div><input placeholder="航班號" className="font-bold text-lg text-slate-800 placeholder:text-slate-300 focus:outline-none w-40 font-serif" value={currentDayData.flight.code} onChange={(e) => updateFlight('code', e.target.value)} /></div><button onClick={toggleFlight} className="text-xs text-red-400 hover:text-red-600 px-3 py-1 rounded hover:bg-red-50 transition-colors">移除</button></div>
							<div className="flex items-center justify-between mb-6 px-2">
								<div className="flex flex-col items-start w-1/3"><span className="text-xs text-slate-400 mb-1 uppercase tracking-wider">Departure</span><input placeholder="DEP" className="text-4xl font-black text-slate-800 w-full bg-transparent focus:outline-none placeholder:text-slate-200 uppercase font-serif" value={currentDayData.flight.from} onChange={(e) => updateFlight('from', e.target.value.toUpperCase())} maxLength={3} /><input type="time" className="mt-1 text-sm font-medium text-slate-500 bg-slate-50 rounded px-1 w-full font-serif" value={currentDayData.flight.depTime || ''} onChange={(e) => updateFlight('depTime', e.target.value)} /></div>
								<div className="flex flex-col items-center justify-center w-1/3"><div className="w-full h-px bg-slate-300 relative top-3"></div><div className="bg-white z-10 px-2"><Plane className="rotate-90 text-slate-300" size={24} /></div><span className="text-[10px] text-slate-400 mt-2 font-mono">TO</span></div>
								<div className="flex flex-col items-end w-1/3"><span className="text-xs text-slate-400 mb-1 uppercase tracking-wider text-right w-full">Arrival</span><input placeholder="ARR" className="text-4xl font-black text-slate-800 w-full text-right bg-transparent focus:outline-none placeholder:text-slate-200 uppercase font-serif" value={currentDayData.flight.to} onChange={(e) => updateFlight('to', e.target.value.toUpperCase())} maxLength={3} /><input type="time" className="mt-1 text-sm font-medium text-slate-500 bg-slate-50 rounded px-1 w-full text-right font-serif" value={currentDayData.flight.arrTime || ''} onChange={(e) => updateFlight('arrTime', e.target.value)} /></div>
							</div>
						</div>
						<div className="relative h-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between"><div className="w-3 h-3 bg-slate-100 rounded-full -ml-1.5 border-r border-slate-200"></div><div className="border-t border-dashed border-slate-300 w-full h-px"></div><div className="w-3 h-3 bg-slate-100 rounded-full -mr-1.5 border-l border-slate-200"></div></div>
						<div className="bg-slate-50 p-3 flex justify-between items-center text-xs text-slate-400"><span>BOARDING PASS</span><span>CLASS: ECONOMY</span></div>
					</div>
				)}
			</div>

			<div>
				<div className="flex justify-between items-center mb-4"><h4 className="font-bold text-slate-700">每日行程</h4><button onClick={addEvent} className="flex items-center gap-1 text-sm text-blue-600 font-medium hover:text-blue-700"><Plus size={16} /> 新增</button></div>
				<div className="space-y-4">
					{(currentDayData.events || []).map((event) => (
						<div key={event.id} className="relative pl-6 border-l-2 border-slate-200 ml-2">
							<div className="absolute -left-[9px] top-0 w-4 h-4 bg-white rounded-full border-2 border-slate-300 shadow-sm flex items-center justify-center p-0.5">
								<div className="w-full h-full bg-slate-300 rounded-full"></div>
							</div>
							<div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 group hover:shadow-md transition-shadow">
								<div className="flex items-start gap-3 mb-2">
									<div className="flex items-center text-slate-800 w-24 shrink-0 mt-1">
										<input type="time" className="w-full bg-slate-50 border border-slate-200 rounded px-1 text-sm font-bold font-mono focus:outline-none focus:border-blue-300 text-slate-800" value={event.time} onChange={(e) => updateEvent(event.id, 'time', e.target.value)} />
									</div>
									<div className="flex-1">
										<div className="flex items-center gap-2 mb-1">
											<div className="relative group/type">
												<button className="p-1 rounded hover:bg-slate-100 text-slate-500"><EventIcon type={event.type} /></button>
												<div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 shadow-lg rounded-lg p-1 hidden group-hover/type:flex gap-1 z-10">{['food', 'attraction', 'transport', 'stay', 'shopping'].map(t => (<button key={t} onClick={() => updateEvent(event.id, 'type', t)} className={`p-1.5 rounded hover:bg-slate-100 ${event.type === t ? 'bg-blue-50' : ''}`} title={t}><EventIcon type={t} /></button>))}</div>
											</div>
											<input type="text" placeholder="地點名稱" className="flex-1 font-bold text-slate-800 bg-transparent focus:outline-none border-b border-transparent focus:border-slate-300 pb-0.5" value={event.location} onChange={(e) => updateEvent(event.id, 'location', e.target.value)} />
										</div>
										<textarea placeholder="備註、計畫..." className="w-full bg-transparent text-sm text-slate-500 focus:outline-none resize-none" rows={1} value={event.note} onChange={(e) => updateEvent(event.id, 'note', e.target.value)} />
									</div>
									<button onClick={() => deleteEvent(event.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity p-1"><Trash2 size={16} /></button>
								</div>
							</div>
						</div>
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

			{subView === 'itinerary' && (
				<div className="bg-white border-b border-slate-200 overflow-x-auto no-scrollbar whitespace-nowrap px-4 py-3 sticky top-[60px] z-10 flex items-center">
					<div className="flex gap-3">
						{dates.map((d) => (
							<button key={d.dateStr} onClick={() => setSelectedDateStr(d.dateStr)} className={`flex flex-col items-center justify-center min-w-[70px] py-2 rounded-xl border transition-all ${selectedDateStr === d.dateStr ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200 scale-105' : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'}`}><span className="text-xs font-medium opacity-80">{d.dayNum}</span><span className="text-sm font-bold">{d.displayDate}</span></button>
						))}
						<button onClick={handleExtendTrip} className="flex flex-col items-center justify-center min-w-[50px] py-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-all" title="新增一天"><Plus size={20} /></button>
					</div>
				</div>
			)}

			<div className="flex-1 overflow-y-auto p-4">
				{subView === 'itinerary' && renderItinerary()}
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
	if (!user) return <div className="p-10 text-center text-slate-400">正在連接記帳資料庫...</div>;

	return (
		<div className="space-y-4 pb-24 animate-in fade-in duration-300 font-serif">
			<div className="bg-emerald-600 text-white p-6 rounded-2xl shadow-lg shadow-emerald-200 mb-6"><div className="text-emerald-100 text-sm mb-1">本行程總花費</div><div className="text-4xl font-bold tracking-wider">${total.toLocaleString()}</div></div>
			<div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
				<div className="p-4 bg-slate-50 font-bold text-slate-700 border-b border-slate-200 flex justify-between items-center"><span>消費紀錄 (雲端同步)</span>{loading && <span className="text-xs text-slate-400 animate-pulse">更新中...</span>}</div>
				<div className="divide-y divide-slate-100">
					{expenses.map(exp => (
						<div key={exp.id} className="p-4 flex justify-between items-center group">
							<div><div className="font-bold text-slate-800">{exp.item}</div><div className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full inline-block mt-1">{exp.category}</div></div>
							<div className="flex items-center gap-3"><span className="font-mono font-medium text-emerald-600">${exp.amount.toLocaleString()}</span><button onClick={() => removeExpense(exp.id)} className="text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16} /></button></div>
						</div>
					))}
					{expenses.length === 0 && !loading && <div className="p-8 text-center text-slate-400 text-sm italic">暫無記帳資料</div>}
				</div>
			</div>
			<form className="bg-white p-4 rounded-xl shadow-sm border border-slate-100" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.target); addExpense(fd.get('item'), fd.get('amount'), 'General'); e.target.reset(); }}>
				<h4 className="font-bold text-slate-700 mb-3">新增消費</h4>
				<div className="grid grid-cols-3 gap-3 mb-3"><input name="item" required placeholder="項目" className="col-span-2 bg-slate-50 p-2 rounded border-none text-sm font-serif" /><input name="amount" required type="number" placeholder="金額" className="col-span-1 bg-slate-50 p-2 rounded border-none text-sm font-serif" /></div><button type="submit" className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-900 transition-colors">新增一筆</button>
			</form>
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
	const [trips, setTrips] = useState([]); // Default to empty array per user request
	const [view, setView] = useState('home');
	const [activeTripId, setActiveTripId] = useState(null);
	const [showAddModal, setShowAddModal] = useState(false);
	const [isSidebarOpen, setSidebarOpen] = useState(false);
	const fileInputRef = useRef(null);

	useEffect(() => {
		const saved = localStorage.getItem('my_travel_logs');
		if (saved) { try { setTrips(JSON.parse(saved)); } catch (e) { } }
	}, []);

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

	const activeTrip = trips.find(t => t.id === activeTripId);

	return (
		<>
			<div className="flex h-screen w-full overflow-hidden font-serif text-slate-800 bg-slate-50">
				<div className={`fixed md:relative z-40 h-full w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
					<div className="p-4 h-full flex flex-col">
						<div className="flex items-center justify-between mb-8"><h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-widest">TravelLog</h1><button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400"><X /></button></div>
						<div className="flex-1 overflow-y-auto space-y-2">
							<button onClick={() => { setView('home'); setSidebarOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-4 ${view === 'home' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}><Globe size={18} />世界地圖 (首頁)</button>
							<div className="mb-4 space-y-2 border-b border-slate-100 pb-4">
								<div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2">Data Management</div>
								<button onClick={handleDownload} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"><Download size={16} /> 下載行程 (JSON)</button>
								<button onClick={handleUploadClick} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"><Upload size={16} /> 匯入行程</button>
								<input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />
							</div>
							<div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">My Trips</div>
							{trips.map(trip => (<button key={trip.id} onClick={() => { setActiveTripId(trip.id); setView('trip'); setSidebarOpen(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTripId === trip.id && view === 'trip' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}>{trip.country}</button>))}
							<button onClick={() => setShowAddModal(true)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors dashed border border-transparent hover:border-slate-200"><Plus size={16} /> 新增國家</button>
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
						<div className="relative -top-5"><button onClick={() => setShowAddModal(true)} className="bg-blue-600 text-white p-4 rounded-full shadow-lg shadow-blue-200 hover:bg-blue-700 transition-transform active:scale-95"><Plus size={24} /></button></div>
						<button onClick={() => setView('global_expense')} className={`flex flex-col items-center gap-1 ${view === 'global_expense' ? 'text-blue-600' : 'text-slate-400'}`}><DollarSign size={22} /><span className="text-[10px] font-medium">總帳</span></button>
					</div>
				</div>
				{showAddModal && (<AddTripModal onClose={() => setShowAddModal(false)} onAdd={handleAddTrip} />)}
			</div>
		</>
	);
};

export default App;