
import React, { useState } from 'react';
import { Key, Lock, ChevronRight, AlertCircle, CheckCircle, X } from 'lucide-react';
import { setGlobalApiKey } from '../services/gemini';

interface ApiKeyModalProps {
  onComplete: () => void;
  onCancel?: () => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onComplete, onCancel }) => {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    if (!apiKey.trim() || apiKey.length < 20) {
      setError('Please enter a valid Google Gemini API Key.');
      return;
    }

    setIsSaving(true);
    
    // Simulate verification (optional, but good UX)
    setTimeout(() => {
      setGlobalApiKey(apiKey.trim());
      setIsSaving(false);
      onComplete();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 relative">
        
        {/* Close Button (Only if onCancel is provided) */}
        {onCancel && (
            <button 
                onClick={onCancel}
                className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors z-20"
            >
                <X size={20} />
            </button>
        )}

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 px-8 py-6">
          <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4 backdrop-blur-md border border-white/20">
            <Key className="text-white w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">Authentication</h2>
          <p className="text-indigo-200 text-sm">Enter your Gemini API Key to access Nexus Studio.</p>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">API Key</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-500 w-4 h-4" />
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError('');
                }}
                placeholder="AIzbSy..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all placeholder:text-slate-600"
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs mt-2">
                <AlertCircle size={12} /> {error}
              </div>
            )}
          </div>

          <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-4">
            <h4 className="text-slate-300 text-sm font-medium mb-2 flex items-center gap-2">
              <CheckCircle size={14} className="text-emerald-500" /> Why is this required?
            </h4>
            <p className="text-slate-500 text-xs leading-relaxed">
              Nexus Studio runs entirely in your browser. To communicate with Google's AI models, it needs your personal API key. 
              <br/><br/>
              <span className="text-slate-400 font-medium">Your key is stored locally in your browser and is never sent to our servers.</span>
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait shadow-lg shadow-indigo-600/20"
            >
              {isSaving ? 'Verifying...' : 'Access Studio'} <ChevronRight size={16} />
            </button>
            
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noreferrer"
              className="text-center text-xs text-slate-500 hover:text-indigo-400 transition-colors"
            >
              Don't have a key? Get one from Google AI Studio &rarr;
            </a>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ApiKeyModal;
