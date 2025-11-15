import React, { useState, useEffect } from 'react';

export default function PiDebugButton() {
  const [isVisible, setIsVisible] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Check if running in Pi Browser
    const isPiBrowser = 
      typeof window !== 'undefined' && 
      (window.Pi !== undefined || navigator.userAgent.includes('PiBrowser'));
    
    // Check if mobile (width < 768px)
    const isMobile = window.innerWidth < 768;
    
    setIsVisible(isPiBrowser && isMobile);
  }, []);

  if (!isVisible) return null;

  const handleReload = () => {
    window.location.reload();
  };

  const handleShowConsole = () => {
    console.log('Pi Debug Active:', window);
    console.log('Pi SDK available:', !!window.Pi);
    console.log('User Agent:', navigator.userAgent);
    setShowModal(false);
  };

  const handleClearLocalStorage = () => {
    localStorage.clear();
    alert('Local storage cleared');
    setShowModal(false);
  };

  const handleHardReload = () => {
    sessionStorage.clear();
    window.location.reload();
  };

  return (
    <>
      {/* Debug Button */}
      <button
        onClick={() => setShowModal(!showModal)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          color: 'white',
          border: 'none',
          fontSize: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 999999,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
        }}
        aria-label="Pi Debug Menu"
      >
        ⚙️
      </button>

      {/* Debug Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            bottom: '90px',
            right: '20px',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            borderRadius: '8px',
            padding: '16px',
            zIndex: 999999,
            minWidth: '200px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div style={{ color: 'white', fontWeight: 'bold', marginBottom: '12px', fontSize: '14px' }}>
            Pi Debug Menu
          </div>
          
          <button
            onClick={handleReload}
            style={{
              width: '100%',
              padding: '10px',
              marginBottom: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Reload Page
          </button>

          <button
            onClick={handleShowConsole}
            style={{
              width: '100%',
              padding: '10px',
              marginBottom: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Show Console Logs
          </button>

          <button
            onClick={handleClearLocalStorage}
            style={{
              width: '100%',
              padding: '10px',
              marginBottom: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Clear Local Storage
          </button>

          <button
            onClick={handleHardReload}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Clear Session & Hard Reload
          </button>
        </div>
      )}
    </>
  );
}
