
import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import RepoView from './components/RepoView';
import ApiKeyModal from './components/ApiKeyModal';
import { ActiveView } from './types';
import { hasValidKey } from './services/gemini';

const App: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('agent');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);

  useEffect(() => {
    // Check if key exists in storage on mount
    const valid = hasValidKey();
    setIsAuthenticated(valid);
    if (!valid) {
        setShowKeyModal(true);
    }
  }, []);

  const handleKeyUpdateComplete = () => {
      setIsAuthenticated(true);
      setShowKeyModal(false);
  };

  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden font-sans text-slate-100 selection:bg-indigo-500/30">
      {/* Show modal if not authenticated OR if explicitly requested via showKeyModal */}
      {(showKeyModal || !isAuthenticated) && (
        <ApiKeyModal 
            onComplete={handleKeyUpdateComplete} 
            onCancel={isAuthenticated ? () => setShowKeyModal(false) : undefined}
        />
      )}
      
      <Sidebar 
        activeView={activeView} 
        onViewChange={setActiveView}
        onToggleSettings={() => setShowSettings(prev => !prev)} 
        onChangeKey={() => setShowKeyModal(true)}
      />
      <main className="flex-1 flex flex-col h-full relative overflow-hidden">
        <RepoView 
          activeView={activeView}
          onViewChange={setActiveView}
          showSettings={showSettings} 
          onToggleSettings={() => setShowSettings(prev => !prev)} 
        />
      </main>
    </div>
  );
};

export default App;
