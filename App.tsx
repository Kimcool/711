
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, Coordinates, StoreInfo } from './types';
import { findNearbyStores, geocodeAddress } from './services/geminiService';
import StoreCard from './components/StoreCard';

declare const L: any;

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    loading: false,
    error: null,
    location: null,
    stores: [],
    rawResponse: ''
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showPanel, setShowPanel] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');
  
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const rangeCircleRef = useRef<any>(null);
  const initialized = useRef(false);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map('map', {
        zoomControl: false,
        fadeAnimation: true,
        markerZoomAnimation: true
      }).setView([20, 0], 3);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(mapRef.current);

      L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    }
  }, []);

  const updateMap = useCallback((center: Coordinates, stores: StoreInfo[]) => {
    if (!mapRef.current) return;

    mapRef.current.flyTo([center.latitude, center.longitude], 13, {
      duration: 1.5,
      easeLinearity: 0.25
    });

    if (userMarkerRef.current) mapRef.current.removeLayer(userMarkerRef.current);
    if (rangeCircleRef.current) mapRef.current.removeLayer(rangeCircleRef.current);
    
    rangeCircleRef.current = L.circle([center.latitude, center.longitude], {
      radius: 5000,
      color: '#008062',
      fillColor: '#008062',
      fillOpacity: 0.05,
      weight: 1,
      dashArray: '5, 10'
    }).addTo(mapRef.current);

    const centerIcon = L.divIcon({
      className: 'center-location-marker',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping scale-150"></div>
          <div class="relative bg-[#008062] w-8 h-8 rounded-full border-4 border-white shadow-xl flex items-center justify-center text-white">
            <i class="fa-solid fa-crosshairs text-sm"></i>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    
    userMarkerRef.current = L.marker([center.latitude, center.longitude], { 
      icon: centerIcon, 
      zIndexOffset: 2000 
    }).addTo(mapRef.current);

    markersRef.current.forEach(m => mapRef.current.removeLayer(m));
    markersRef.current = [];

    stores.forEach((store, index) => {
      if (store.lat && store.lng) {
        const icon = L.divIcon({
          className: 'store-marker-container',
          html: `
            <div class="store-marker animate-drop" style="animation-delay: ${index * 50}ms">
              <div class="marker-pin-premium scale-75 md:scale-90">
                <div class="pin-inner-logo">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/4/40/7-eleven_logo.svg" alt="7-11" style="width: 20px; height: 20px;" />
                </div>
              </div>
            </div>
          `,
          iconSize: [32, 40],
          iconAnchor: [16, 40]
        });

        const marker = L.marker([store.lat, store.lng], { icon }).addTo(mapRef.current);
        marker.bindPopup(`<div class="p-2 font-bold">${store.name}</div><div class="px-2 pb-2 text-xs text-gray-500">${store.address}</div>`, { closeButton: false });
        markersRef.current.push(marker);
      }
    });
  }, []);

  const runSearch = useCallback(async (coords: Coordinates) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    setStatusMsg('正在寻找 5km 内的 7-Eleven...');
    
    try {
      const result = await findNearbyStores(coords);
      setState(prev => ({
        ...prev,
        loading: false,
        location: coords,
        stores: result.stores,
        rawResponse: result.text
      }));
      updateMap(coords, result.stores);
      if (result.stores.length > 0) setShowPanel(true);
    } catch (err: any) {
      setState(prev => ({ ...prev, loading: false, error: err.message }));
    } finally {
      setStatusMsg('');
    }
  }, [updateMap]);

  const handleManualSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    setState(prev => ({ ...prev, loading: true, error: null }));
    setStatusMsg(`正在定位 "${searchTerm}"...`);
    
    const coords = await geocodeAddress(searchTerm);
    if (coords) {
      runSearch(coords);
    } else {
      setState(prev => ({ ...prev, loading: false, error: "找不到该地点，请尝试输入更具体的地址。" }));
      setStatusMsg('');
    }
  };

  const locateUser = useCallback(() => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    setStatusMsg('正在获取您的位置...');
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setSearchTerm('');
        runSearch(coords);
      },
      (err) => {
        setState(prev => ({ 
          ...prev, 
          loading: false, 
          error: "无法获取您的位置。请确保已开启 GPS 权限，或在上方搜索框输入地点。" 
        }));
        setStatusMsg('');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [runSearch]);

  useEffect(() => {
    if (mapRef.current && !initialized.current) {
      initialized.current = true;
      locateUser();
    }
  }, [locateUser]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white flex flex-col antialiased">
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-3 md:px-8 py-2 md:py-4 flex flex-col md:flex-row gap-2 md:gap-4 items-stretch md:items-center justify-between z-[1100] shadow-md">
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <div className="flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-lg md:rounded-xl bg-white shadow-sm border border-gray-100 p-1 md:p-1.5">
            <img src="https://upload.wikimedia.org/wikipedia/commons/4/40/7-eleven_logo.svg" alt="7-Eleven" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-sm md:text-xl font-black text-gray-800 tracking-tight uppercase leading-none">711 FINDER</h1>
            <p className="text-[8px] md:text-[9px] text-[#F37021] font-black tracking-[0.1em] md:tracking-[0.2em] uppercase mt-0.5 md:mt-1">Make Life Better</p>
          </div>
        </div>
        
        <div className="flex flex-1 md:max-w-2xl gap-2 items-center">
          <form onSubmit={handleManualSearch} className="relative flex-1 group">
            <i className="fa-solid fa-magnifying-glass absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#008062] transition-colors text-xs md:text-sm"></i>
            <input 
              type="text" 
              placeholder="搜索地点..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl md:rounded-2xl py-2 md:py-3 pl-9 md:pl-11 pr-3 text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#008062]/20 focus:border-[#008062] focus:bg-white transition-all"
            />
          </form>
          
          <button
            onClick={locateUser}
            className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 h-9 w-9 md:h-12 md:w-12 flex items-center justify-center rounded-xl md:rounded-2xl shadow-sm transition-all active:scale-95 shrink-0"
            title="使用我的位置"
          >
            <i className="fa-solid fa-location-crosshairs text-xs md:text-base"></i>
          </button>
          
          <button
            onClick={() => handleManualSearch()}
            disabled={state.loading || !searchTerm.trim()}
            className="bg-[#008062] hover:bg-[#006b52] text-white h-9 md:h-12 px-3 md:px-6 rounded-xl md:rounded-2xl font-black shadow-lg shadow-green-900/10 transition-all active:scale-95 disabled:opacity-50 text-[10px] md:text-xs uppercase tracking-widest flex items-center gap-2 shrink-0"
          >
            {state.loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-bolt"></i>}
            <span className="hidden sm:inline">搜索</span>
          </button>
        </div>
      </header>

      <div className="flex-1 relative mt-[88px] md:mt-[76px]">
        <div id="map" className="absolute inset-0 z-0"></div>

        {statusMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-black/70 backdrop-blur-md text-white px-5 py-1.5 rounded-full text-[10px] md:text-xs font-bold tracking-wide animate-pulse flex items-center gap-2">
            <i className="fa-solid fa-circle-notch fa-spin text-emerald-400"></i>
            {statusMsg}
          </div>
        )}

        <div 
          className={`
            absolute z-10 transition-all duration-500 ease-in-out flex flex-col border border-white/50
            bg-white/80 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)]
            inset-x-2 bottom-2 max-h-[45vh] rounded-[2rem]
            md:top-6 md:left-6 md:bottom-6 md:w-[22rem] md:inset-x-auto md:max-h-none
            ${showPanel ? 'translate-y-0 md:translate-x-0 opacity-100' : 'translate-y-[calc(100%+2rem)] md:-translate-x-[calc(100%+4rem)] opacity-0 pointer-events-none'}
          `}
        >
          <div className="p-4 md:p-7 border-b border-gray-100/50 flex justify-between items-center bg-white/40 rounded-t-[2rem] shrink-0">
            <div>
              <h2 className="font-black text-gray-800 flex items-center gap-2 uppercase tracking-tighter text-xs md:text-base">
                <i className="fa-solid fa-store text-[#EE2737]"></i>
                周边网点
              </h2>
              <p className="text-[8px] md:text-[10px] text-gray-400 font-bold mt-0.5 md:mt-1 uppercase tracking-widest">
                {state.loading ? '正在检索...' : `5KM 内发现 ${state.stores.length} 个结果`}
              </p>
            </div>
            <button 
              onClick={() => setShowPanel(false)}
              className="bg-gray-100/80 hover:bg-white w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-all text-gray-400 shadow-sm"
            >
              <i className="fa-solid fa-chevron-down md:hidden text-xs"></i>
              <i className="fa-solid fa-chevron-left hidden md:block text-xs"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-3 md:space-y-4 scroll-smooth scrollbar-hide">
            {state.error && (
              <div className="bg-red-50/90 p-4 md:p-5 rounded-2xl md:rounded-3xl border border-red-100 text-red-600 animate-shake">
                <div className="flex items-center gap-2 font-black text-[10px] md:text-sm mb-1 md:mb-2">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  <span>出错了</span>
                </div>
                <p className="text-[10px] md:text-xs leading-relaxed font-medium">{state.error}</p>
              </div>
            )}

            {state.loading && (
              <div className="space-y-3 md:space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse flex gap-3 md:gap-4 p-4 md:p-5 bg-white/50 rounded-2xl md:rounded-3xl border border-white">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-gray-200/50 rounded-xl md:rounded-2xl"></div>
                    <div className="flex-1 space-y-2 md:space-y-3 py-1">
                      <div className="h-3 md:h-4 bg-gray-200/50 rounded w-3/4"></div>
                      <div className="h-2 md:h-3 bg-gray-200/50 rounded w-1/2"></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!state.loading && state.stores.length === 0 && !state.error && (
              <div className="text-center py-12 md:py-20 px-6 md:px-8 opacity-60">
                <div className="bg-gray-100/50 w-16 h-16 md:w-24 md:h-24 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6 border-4 border-white shadow-inner">
                  <i className="fa-solid fa-map-location-dot text-gray-300 text-2xl md:text-3xl"></i>
                </div>
                <h3 className="text-gray-600 font-black text-[10px] md:text-sm uppercase tracking-tight">空空如也</h3>
                <p className="text-gray-400 text-[10px] md:text-xs mt-2 md:mt-3 leading-relaxed">在这个区域 5km 范围内没有找到 7-Eleven。</p>
              </div>
            )}

            {!state.loading && state.stores.map((store, idx) => (
              <div key={idx} className="hover:scale-[1.02] active:scale-95 transition-all duration-300 cursor-pointer">
                <StoreCard store={store} userLocation={state.location} />
              </div>
            ))}
          </div>
          
          {state.location && (
            <div className="p-3 md:p-4 bg-gray-50/50 border-t border-gray-100/50 rounded-b-[2rem] shrink-0">
              <div className="flex items-center justify-between text-[8px] md:text-[10px] text-gray-400 font-black uppercase tracking-[0.1em] md:tracking-[0.15em]">
                <span>中心点</span>
                <span className="bg-[#008062]/10 text-[#008062] px-2 md:px-3 py-0.5 md:py-1 rounded-full">
                  {state.location.latitude.toFixed(4)}, {state.location.longitude.toFixed(4)}
                </span>
              </div>
            </div>
          )}
        </div>

        {!showPanel && (
          <button 
            onClick={() => setShowPanel(true)}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 md:translate-x-0 md:bottom-auto md:top-8 md:left-8 bg-white/90 backdrop-blur-xl px-4 md:px-6 py-3 md:py-4 rounded-2xl md:rounded-3xl shadow-2xl z-10 text-[#008062] hover:bg-white transition-all active:scale-90 border border-white flex items-center gap-2 md:gap-3 font-black text-[10px] md:text-xs uppercase tracking-widest"
          >
            <i className="fa-solid fa-list-ul text-base md:text-lg"></i>
            <span>查看网点列表</span>
          </button>
        )}
      </div>

      <style>{`
        .leaflet-container { font-family: 'Inter', sans-serif; background: #f8f9fa; }
        .marker-pin-premium {
          width: 32px;
          height: 32px;
          border-radius: 50% 50% 50% 0;
          background: white;
          position: absolute;
          transform: rotate(-45deg);
          left: 50%;
          top: 50%;
          margin: -16px 0 0 -16px;
          border: 2px solid #008062;
          box-shadow: 0 4px 10px rgba(0,0,0,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .pin-inner-logo { transform: rotate(45deg); }
        @keyframes drop {
          0% { transform: translateY(-40px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-drop { animation: drop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.3s ease-in-out infinite alternate; animation-iteration-count: 2; }
      `}</style>
    </div>
  );
};

export default App;
