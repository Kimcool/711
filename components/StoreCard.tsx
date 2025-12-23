
import React from 'react';
import { StoreInfo, Coordinates } from '../types';

interface StoreCardProps {
  store: StoreInfo;
  userLocation?: Coordinates | null;
}

const StoreCard: React.FC<StoreCardProps> = ({ store, userLocation }) => {
  // Construct a walking route URL if we have both user location and store location
  const getGoogleMapsUrl = () => {
    if (userLocation && store.lat && store.lng) {
      const origin = `${userLocation.latitude},${userLocation.longitude}`;
      const destination = `${store.lat},${store.lng}`;
      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
    }
    // Fallback to the original URI provided by grounding metadata
    return store.uri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.name + " " + store.address)}`;
  };

  const mapUrl = getGoogleMapsUrl();

  return (
    <div className="group bg-white/60 backdrop-blur-sm rounded-2xl border border-white shadow-sm overflow-hidden hover:shadow-xl hover:bg-white hover:-translate-y-1 transition-all duration-400">
      <div className="flex">
        {/* Color stripe for branding */}
        <div className="w-1.5 flex flex-col shrink-0">
          <div className="h-1/3 bg-[#F37021]"></div>
          <div className="h-1/3 bg-[#008062]"></div>
          <div className="h-1/3 bg-[#EE2737]"></div>
        </div>
        
        <div className="p-4 flex-1 overflow-hidden">
          <div className="flex justify-between items-start mb-1">
            <h3 className="font-black text-gray-800 text-sm tracking-tight leading-tight group-hover:text-[#008062] transition-colors truncate">
              {store.name || "7-Eleven Store"}
            </h3>
          </div>
          
          <p className="text-gray-400 text-[11px] mb-4 flex items-start gap-1.5 leading-snug">
            <i className="fa-solid fa-location-dot mt-0.5 text-[#EE2737]/60 shrink-0"></i>
            <span className="truncate">{store.address}</span>
          </p>
          
          <a 
            href={mapUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center justify-between w-full bg-gray-50/80 group-hover:bg-[#008062] group-hover:text-white text-gray-500 font-black text-[10px] uppercase tracking-widest py-2.5 px-3 rounded-xl transition-all duration-300"
          >
            <span>开始步行导航</span>
            <i className="fa-solid fa-person-walking text-[12px]"></i>
          </a>
        </div>
      </div>
    </div>
  );
};

export default StoreCard;
