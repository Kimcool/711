
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, Coordinates, StoreInfo } from './types';
import { findNearbyStores } from './services/geminiService';
import StoreCard from './components/StoreCard';

// Fix: Declare L for Leaflet global
declare const L: any;

const GINZA_COORDS: Coordinates = {
  latitude: 35.6715,
  longitude: 139.7649
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    loading: false,
    error: null,
    location: null,
    stores: [],
    rawResponse: ''
  });
  // Default to mocking (Ginza) to ensure user sees results immediately
  const [isMocking, setIsMocking] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const initialized = useRef(false);

  // Map Initialization
  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map('map', {
        zoomControl: false,
        fadeAnimation: true,
        markerZoomAnimation: true
      }).setView([35.6762, 139.7503], 13);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(mapRef.current);

      L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    }
  }, []);

  // Handle auto-centering on resize
  useEffect(() => {
    const handleResize = () => {
      if (mapRef.current && state.location) {
        mapRef.current.setView([state.location.latitude, state.location.longitude], mapRef.current.getZoom(), {
          animate: false
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [state.location]);

  const clearMarkers = () => {
    markersRef.current.forEach(m => mapRef.current.removeLayer(m));
    markersRef.current = [];
  };

  const updateMap = useCallback((center: Coordinates, stores: StoreInfo[]) => {
    if (!mapRef.current) return;

    mapRef.current.flyTo([center.latitude, center.longitude], 15, {
      duration: 1.5,
      easeLinearity: 0.25
    });

    if (userMarkerRef.current) mapRef.current.removeLayer(userMarkerRef.current);
    
    // Updated User Icon: Larger, Red, Person Icon
    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="absolute inset-0 bg-red-500/20 rounded-full animate-ping scale-150"></div>
          <div class="relative bg-[#EE2737] w-8 h-8 md:w-10 md:h-10 rounded-full border-2 md:border-4 border-white shadow-xl flex items-center justify-center text-white">
            <i class="fa-solid fa-person-walking text-base md:text-xl"></i>
          </div>
          <div class="absolute -bottom-1 w-2 h-2 bg-[#EE2737] rotate-45 border-r-2 border-b-2 border-white"></div>
        </div>
      `,
      iconSize: [40, 44],
      iconAnchor: [20, 44]
    });
    
    userMarkerRef.current = L.marker([center.latitude, center.longitude], { 
      icon: userIcon, 
      zIndexOffset: 2000 
    }).addTo(mapRef.current);

    const userPopupContent = `
      <div class="px-3 py-1.5 text-center">
        <p class="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-[#EE2737] mb-0.5">Current Location</p>
        <p class="text-xs font-bold text-gray-800">${isMocking ? "东京银座 (模拟)" : "你的位置"}</p>
      </div>
    `;

    userMarkerRef.current.bindPopup(userPopupContent, {
      closeButton: false,
      offset: L.point(0, -50),
      className: 'user-popup'
    }).openPopup();

    clearMarkers();

    stores.forEach((store, index) => {
      if (store.lat && store.lng) {
        const icon = L.divIcon({
          className: 'store-marker-container',
          html: `
            <div class="store-marker animate-drop" style="animation-delay: ${index * 100}ms">
              <div class="marker-pin-premium scale-75 md:scale-100">
                <div class="pin-inner-logo">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/4/40/7-eleven_logo.svg" alt="7-Eleven" style="width: 24px; height: 24px; object-fit: contain;" />
                </div>
              </div>
              <div class="marker-shadow scale-75 md:scale-100"></div>
            </div>
          `,
          iconSize: [40, 48],
          iconAnchor: [20, 48]
        });

        const marker = L.marker([store.lat, store.lng], { icon }).addTo(mapRef.current);
        
        const popupContent = `
          <div class="p-2 min-w-[120px]">
            <div class="flex items-center gap-2 mb-1">
              <div class="w-1 h-3 bg-[#008062]"></div>
              <h4 class="font-black text-gray-800 text-xs md:text-sm">${store.name}</h4>
            </div>
            <p class="text-[10px] md:text-xs text-gray-500 mb-2">${store.address}</p>
            ${store.uri ? `<a href="${store.uri}" target="_blank" class="text-[9px] md:text-[10px] font-bold text-[#F37021] uppercase tracking-tighter hover:underline">查看详情 →</a>` : ''}
          </div>
        `;
        
        marker.bindPopup(popupContent, {
          closeButton: false,
          offset: L.point(0, -40)
        });
        
        markersRef.current.push(marker);
      }
    });
  }, [isMocking]);

  const handleSearch = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      let coords = GINZA_COORDS;
      
      if (!isMocking) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { 
            timeout: 10000,
            enableHighAccuracy: true 
          });
        }).catch(() => null);
        
        if (pos) {
          coords = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude
          };
        } else {
          setIsMocking(true); 
        }
      }

      const result = await findNearbyStores(coords);
      setState(prev => ({
        ...prev,
        loading: false,
        location: coords,
        stores: result.stores,
        rawResponse: result.text
      }));

      updateMap(coords, result.stores);
      // Automatically show panel when results come in on mobile if it was hidden
      if (result.stores.length > 0) setShowPanel(true);
    } catch (err: any) {
      setState(prev => ({ ...prev, loading: false, error: err.message }));
    }
  }, [isMocking, updateMap]);

  useEffect(() => {
    if (mapRef.current && !initialized.current) {
      initialized.current = true;
      const timer = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [handleSearch]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white flex flex-col antialiased">
      {/* Responsive Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 md:px-6 py-3 md:py-4 flex justify-between items-center z-20 shadow-sm">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-lg md:rounded-xl bg-white shadow-md border border-gray-100 overflow-hidden p-1 md:p-1.5">
            <img src="https://upload.wikimedia.org/wikipedia/commons/4/40/7-eleven_logo.svg" alt="7-Eleven Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-sm md:text-lg font-black text-gray-800 leading-none tracking-tight">711 FINDER</h1>
            <p className="hidden md:block text-[10px] text-[#F37021] font-bold tracking-[0.2em] uppercase mt-0.5">Make Life Better</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4">
          <div className="flex items-center bg-gray-50 p-0.5 md:p-1 rounded-lg md:rounded-xl border border-gray-100">
            <button 
              onClick={() => setIsMocking(false)}
              className={`px-2 md:px-4 py-1 md:py-1.5 text-[10px] md:text-xs font-bold rounded-md md:rounded-lg transition-all ${!isMocking ? 'bg-white shadow-sm text-[#008062]' : 'text-gray-400'}`}
            >
              <span className="md:hidden"><i className="fa-solid fa-location-crosshairs"></i></span>
              <span className="hidden md:inline">真实位置</span>
            </button>
            <button 
              onClick={() => setIsMocking(true)}
              className={`px-2 md:px-4 py-1 md:py-1.5 text-[10px] md:text-xs font-bold rounded-md md:rounded-lg transition-all ${isMocking ? 'bg-white shadow-sm text-[#F37021]' : 'text-gray-400'}`}
            >
              <span className="md:hidden"><i className="fa-solid fa-map-pin"></i></span>
              <span className="hidden md:inline">东京银座</span>
            </button>
          </div>
          
          <button
            onClick={handleSearch}
            disabled={state.loading}
            className="group bg-[#008062] hover:bg-[#006b52] text-white px-3 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl font-bold shadow-lg shadow-green-900/10 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 text-xs md:text-sm"
          >
            {state.loading ? (
              <i className="fa-solid fa-circle-notch fa-spin"></i>
            ) : (
              <i className="fa-solid fa-radar group-hover:animate-pulse"></i>
            )}
            <span className="hidden sm:inline">{state.loading ? '搜索中...' : '刷新'}</span>
            <span className="sm:hidden">{state.loading ? '' : '搜索'}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        {/* Map Container - Full Background */}
        <div id="map" className="absolute inset-0 z-0"></div>

        {/* Responsive Results Panel: Floating Sidebar (Desktop) / Bottom Sheet (Mobile) */}
        <div 
          className={`
            absolute z-10 transition-all duration-500 ease-in-out flex flex-col border border-white/50
            bg-white/70 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.1)]
            /* Mobile styles */
            inset-x-2 bottom-2 max-h-[45vh] rounded-3xl
            /* Desktop styles */
            md:top-6 md:left-6 md:bottom-6 md:w-96 md:inset-x-auto md:max-h-none
            ${showPanel ? 'translate-y-0 md:translate-x-0 opacity-100' : 'translate-y-[calc(100%+2rem)] md:-translate-x-[calc(100%+4rem)] opacity-0 pointer-events-none'}
          `}
        >
          {/* Panel Header */}
          <div className="p-4 md:p-6 border-b border-gray-100/50 flex justify-between items-center sticky top-0 bg-white/40 backdrop-blur-md rounded-t-3xl z-10">
            <div>
              <h2 className="font-black text-gray-800 flex items-center gap-2 uppercase tracking-tight text-xs md:text-sm">
                <i className="fa-solid fa-location-dot text-[#EE2737]"></i>
                周边搜索结果
              </h2>
              <p className="text-[9px] md:text-[10px] text-gray-400 font-bold mt-1 uppercase tracking-widest">
                {state.loading ? '正在云端同步...' : `发现 ${state.stores.length} 个网点`}
              </p>
            </div>
            <button 
              onClick={() => setShowPanel(false)}
              className="bg-gray-100/50 hover:bg-gray-200 w-8 h-8 rounded-full flex items-center justify-center transition-colors text-gray-400 md:hidden"
            >
              <i className="fa-solid fa-chevron-down"></i>
            </button>
            <button 
              onClick={() => setShowPanel(false)}
              className="hidden md:flex bg-gray-50/50 hover:bg-gray-100 w-8 h-8 rounded-full items-center justify-center transition-colors text-gray-400"
            >
              <i className="fa-solid fa-chevron-left"></i>
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 scroll-smooth scrollbar-hide">
            {state.error && (
              <div className="bg-red-50/80 p-4 rounded-2xl border border-red-100 text-red-600 text-sm animate-shake">
                <div className="flex items-center gap-2 font-bold mb-1">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  <span>出错了</span>
                </div>
                <p className="text-xs">{state.error}</p>
              </div>
            )}

            {state.loading && (
              <div className="space-y-3 md:space-y-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse flex gap-3 md:gap-4 p-3 md:p-4 bg-white/40 rounded-2xl">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-gray-200/50 rounded-xl"></div>
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3 md:h-4 bg-gray-200/50 rounded w-3/4"></div>
                      <div className="h-2 md:h-3 bg-gray-200/50 rounded w-1/2"></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!state.loading && state.stores.length === 0 && !state.error && (
              <div className="text-center py-12 md:py-20 px-6 opacity-60">
                <div className="bg-gray-100/50 w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center mx-auto mb-4 border border-white shadow-inner">
                  <i className="fa-solid fa-store-slash text-gray-300 text-xl md:text-2xl"></i>
                </div>
                <h3 className="text-gray-600 font-black text-[10px] md:text-sm uppercase tracking-tight">未发现商店</h3>
                <p className="text-gray-400 text-[9px] md:text-xs mt-2">5km 范围内暂时没有 7-Eleven。</p>
              </div>
            )}

            {!state.loading && state.stores.map((store, idx) => (
              <div key={idx} className="hover:scale-[1.01] md:hover:scale-[1.02] transition-transform duration-300">
                <StoreCard store={store} userLocation={state.location} />
              </div>
            ))}
          </div>
          
          {/* Footer Coordinates */}
          {state.location && (
            <div className="p-3 md:p-4 bg-gray-50/30 backdrop-blur-sm border-t border-gray-100/50 rounded-b-3xl shrink-0">
              <div className="flex items-center justify-between text-[8px] md:text-[9px] text-gray-400 font-black uppercase tracking-widest">
                <span>中心点坐标</span>
                <span className="bg-white/50 px-2 py-0.5 rounded-full border border-gray-100">
                  {state.location.latitude.toFixed(4)}, {state.location.longitude.toFixed(4)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Floating Toggle Button for Sidebar/Bottom Sheet */}
        {!showPanel && (
          <button 
            onClick={() => setShowPanel(true)}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 md:translate-x-0 md:bottom-auto md:top-6 md:left-6 bg-white/80 backdrop-blur-md p-3 md:p-4 rounded-2xl shadow-xl z-10 text-[#008062] hover:bg-white transition-all active:scale-90 border border-white flex items-center gap-2"
          >
            <i className="fa-solid fa-list-ul text-base md:text-lg"></i>
            <span className="md:hidden text-xs font-black uppercase tracking-widest">查看列表</span>
          </button>
        )}
      </div>

      <style>{`
        .leaflet-container { font-family: 'Inter', sans-serif; background: #f8f9fa; }
        
        /* Custom Popup Styles */
        .leaflet-popup-content-wrapper { 
          border-radius: 12px; 
          padding: 0; 
          box-shadow: 0 10px 25px rgba(0,0,0,0.1); 
          border: 1px solid rgba(255,255,255,0.8);
          backdrop-filter: blur(8px);
          background: rgba(255,255,255,0.95);
        }
        .leaflet-popup-content { margin: 0; }
        .leaflet-popup-tip { background: rgba(255,255,255,0.95); }
        
        .user-popup .leaflet-popup-content-wrapper {
          background: rgba(238, 39, 55, 0.05);
          border: 1px solid rgba(238, 39, 55, 0.2);
          backdrop-filter: blur(12px);
        }

        @keyframes drop {
          0% { transform: translateY(-30px); opacity: 0; }
          60% { transform: translateY(5px); }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-drop { animation: drop 0.5s ease-out forwards; }
        
        .marker-pin-premium {
          width: 40px;
          height: 40px;
          border-radius: 50% 50% 50% 0;
          background: white;
          position: absolute;
          transform: rotate(-45deg);
          left: 50%;
          top: 50%;
          margin: -24px 0 0 -20px;
          border: 3px solid #008062;
          box-shadow: 0 6px 15px rgba(0,0,0,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .pin-inner-logo {
          transform: rotate(45deg);
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .marker-shadow {
          background: rgba(0,0,0,0.15);
          border-radius: 50%;
          width: 16px;
          height: 5px;
          position: absolute;
          bottom: -7px;
          left: 50%;
          margin-left: -8px;
          filter: blur(2px);
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-shake { animation: shake 0.3s ease-in-out infinite alternate; animation-iteration-count: 2; }

        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        
        /* Smooth Mobile Transitions */
        @media (max-width: 768px) {
          .leaflet-touch .leaflet-control-zoom { display: none; }
        }
      `}</style>
    </div>
  );
};

export default App;
