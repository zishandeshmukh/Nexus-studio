
import React from 'react';
import { Sparkles, Settings2, Bot, FileText, Workflow, Map, FileCode, GitCommit, KeyRound } from 'lucide-react';
import { ActiveView } from '../types';

interface SidebarProps {
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  onToggleSettings: () => void;
  onChangeKey: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange, onToggleSettings, onChangeKey }) => {
  
  const navItems: { id: ActiveView; icon: React.ElementType; label: string; color?: string }[] = [
    { id: 'agent', icon: Bot, label: 'Agent Studio', color: 'text-emerald-400' },
    { id: 'report', icon: FileText, label: 'Analysis Report', color: 'text-indigo-400' },
    { id: 'diagrams', icon: Workflow, label: 'Architecture', color: 'text-cyan-400' },
    { id: 'roadmap', icon: Map, label: 'Roadmap', color: 'text-amber-400' },
    { id: 'readme', icon: FileCode, label: 'README.md', color: 'text-pink-400' },
    { id: 'commits', icon: GitCommit, label: 'Commits', color: 'text-slate-400' },
  ];

  return (
    <div className="w-16 md:w-20 bg-slate-950 border-r border-slate-800 flex flex-col h-full flex-shrink-0 items-center py-6 z-50">
      <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-8">
        <Sparkles className="text-white w-6 h-6" />
      </div>

      <nav className="flex-1 flex flex-col gap-4 w-full px-2 overflow-y-auto scrollbar-none">
        {navItems.map((item) => (
          <div key={item.id} className="group relative flex justify-center">
            <button
              onClick={() => onViewChange(item.id)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                activeView === item.id
                  ? 'bg-slate-800 text-white shadow-sm ring-1 ring-slate-700'
                  : 'text-slate-500 hover:bg-slate-900 hover:text-slate-300'
              }`}
            >
              <item.icon size={20} className={activeView === item.id ? item.color : undefined} />
            </button>
            
            {/* Tooltip */}
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-900 text-slate-200 text-xs px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-slate-800 shadow-xl z-50 pointer-events-none font-medium flex items-center gap-2">
              {item.label}
              {activeView === item.id && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>}
            </div>
            
            {/* Active Indicator Bar */}
            {activeView === item.id && (
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-r-full" />
            )}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-4 w-full px-2 pt-4 border-t border-slate-900">
        {/* Change Key Button */}
        <div className="group relative flex justify-center">
          <button
            onClick={onChangeKey}
            className="w-10 h-10 rounded-xl text-slate-500 hover:bg-slate-900 hover:text-indigo-400 transition-colors flex items-center justify-center"
          >
            <KeyRound size={20} />
          </button>
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-900 text-slate-200 text-xs px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-slate-800 shadow-xl z-50 pointer-events-none">
            Change API Key
          </span>
        </div>

        <div className="group relative flex justify-center">
          <button
            onClick={onToggleSettings}
            className="w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-900 hover:text-slate-200 transition-colors flex items-center justify-center"
          >
            <Settings2 size={22} />
          </button>
          <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-900 text-slate-200 text-xs px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-slate-800 shadow-xl z-50 pointer-events-none">
            Settings
          </span>
        </div>
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mx-auto mb-2" title="System Online"></div>
      </div>
    </div>
  );
};

export default Sidebar;
