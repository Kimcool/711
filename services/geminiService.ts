
import { GoogleGenAI } from "@google/genai";
import { Coordinates, StoreInfo } from "../types";

export const findNearbyStores = async (coords: Coordinates): Promise<{ text: string; stores: StoreInfo[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `Find all 7-Eleven convenience stores within a 5km radius of: ${coords.latitude}, ${coords.longitude}. 
  Focus ONLY on 7-Eleven stores. 
  
  IMPORTANT: For EVERY store you list, you MUST strictly include its coordinates in this exact line format so my system can map them:
  [DATA] Name | Address | Latitude | Longitude
  
  Example: [DATA] 7-Eleven Ginza 7-Chome | 7-7-1 Ginza, Chuo City, Tokyo | 35.6698 | 139.7615`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: coords.latitude,
              longitude: coords.longitude
            }
          }
        }
      },
    });

    if (!response) {
      throw new Error("Received an empty response from Gemini.");
    }

    const text = response.text || "";
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    
    // Parse the [DATA] tags from the text output
    const storeLines = text.split('\n').filter(line => line.includes('[DATA]'));
    const parsedStores: StoreInfo[] = storeLines.map(line => {
      const content = line.split('[DATA]')[1].trim();
      const parts = content.split('|').map(p => p.trim());
      return {
        name: parts[0] || "7-Eleven",
        address: parts[1] || "点击地图查看详情",
        lat: parseFloat(parts[2]),
        lng: parseFloat(parts[3])
      };
    }).filter(s => !isNaN(s.lat!) && !isNaN(s.lng!));

    // Fallback: If no [DATA] lines found, try to extract from grounding chunks directly if available
    let finalStores = parsedStores;
    if (finalStores.length === 0 && groundingChunks.length > 0) {
      finalStores = groundingChunks
        .filter((chunk: any) => chunk.maps)
        .map((chunk: any) => ({
          name: chunk.maps.title || "7-Eleven",
          address: "点击查看路线",
          uri: chunk.maps.uri,
          // Note: Coordinates might not be directly in the chunk without additional tools
          // but we prioritize structured data for the map.
        }));
    } else {
      // Match parsed stores with grounding chunks to get official URIs
      finalStores = parsedStores.map(ps => {
        const match = groundingChunks.find((chunk: any) => 
          chunk.maps && (
            ps.name.toLowerCase().includes(chunk.maps.title.toLowerCase()) || 
            chunk.maps.title.toLowerCase().includes(ps.name.toLowerCase())
          )
        );
        return {
          ...ps,
          uri: match?.maps?.uri,
          title: match?.maps?.title
        };
      });
    }

    return { text, stores: finalStores };
  } catch (error: any) {
    console.error("Gemini API Error Detail:", error);
    let errorMessage = "无法获取商店信息。";
    if (error.message?.includes("API_KEY_INVALID")) {
      errorMessage = "API 密钥无效，请检查环境变量。";
    } else if (error.message) {
      errorMessage = `错误: ${error.message}`;
    }
    throw new Error(errorMessage);
  }
};
