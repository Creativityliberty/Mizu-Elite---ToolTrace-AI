import React from 'react';
import { ToolMention } from '../types';
import { ICONS } from '../constants';

interface ToolCardProps {
  tool: ToolMention;
  index: number;
  videoId: string;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool, index, videoId }) => {
  if (!tool) return null;

  return (
    <div className="mizu-card flex flex-col h-full group animate-reveal border-0 overflow-hidden bg-white shadow-sm" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="h-48 w-full bg-[#0a0f1d] relative overflow-hidden">
        {tool.aiThumbnail ? (
          <img src={tool.aiThumbnail} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[2000ms] opacity-90" alt={tool.name} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 to-[#0a0f1d]">
            <div className="opacity-10 scale-150 rotate-12"><ICONS.Github /></div>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent"></div>
        <div className="absolute top-6 left-6 flex gap-2">
          <span className="text-[9px] font-black px-3 py-1.5 rounded-full bg-white/20 backdrop-blur-xl text-white border border-white/30 uppercase tracking-[0.2em] shadow-lg">
            {tool.category || 'Tech'}
          </span>
        </div>
        {tool.timestampLabel && (
          <a 
            href={`https://youtu.be/${videoId}?t=${tool.timestampOffset || 0}`} 
            target="_blank" 
            rel="noopener noreferrer"
            className="absolute top-6 right-6 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/80 backdrop-blur-md text-[9px] font-black text-white hover:bg-blue-600 transition-colors shadow-lg"
          >
            <ICONS.Clock /> {tool.timestampLabel}
          </a>
        )}
      </div>

      <div className="px-8 pb-10 flex-1 flex flex-col relative">
        <div className="absolute -top-6 right-8 w-12 h-12 bg-white rounded-2xl shadow-xl flex items-center justify-center group-hover:-translate-y-2 transition-transform duration-500">
           <span className="text-xl font-black text-[#0a0f1d] outfit leading-none">{index + 1}</span>
        </div>
        <h3 className="text-2xl font-extrabold text-[#0a0f1d] mb-1 tracking-tighter outfit leading-none pt-4">{tool.name}</h3>
        <p className="text-[10px] text-slate-300 font-bold mb-5 outfit tracking-widest uppercase">Node Identifié</p>
        <p className="text-sm text-slate-500 font-medium mb-8 leading-relaxed line-clamp-3">{tool.notes?.[0] || "Aucune description technique disponible."}</p>
        <div className="mt-auto pt-6 border-t border-slate-50 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[20px] font-black text-[#0a0f1d] leading-none outfit">{tool.mentionsCount || 0}</span>
            <span className="text-[8px] uppercase text-slate-300 tracking-[0.2em] font-black mt-1">Occurrences</span>
          </div>
          <div className="flex gap-3">
            {tool.githubUrl && <a href={tool.githubUrl} target="_blank" rel="noopener noreferrer" className="w-11 h-11 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 hover:bg-slate-900 hover:text-white transition-all shadow-sm"><ICONS.Github /></a>}
            <a href={tool.officialUrl || tool.githubUrl || "#"} target="_blank" rel="noopener noreferrer" className="w-11 h-11 bg-[#0a0f1d] rounded-2xl flex items-center justify-center text-white hover:bg-blue-600 transition-all shadow-md"><ICONS.ExternalLink /></a>
          </div>
        </div>
      </div>
    </div>
  );
};