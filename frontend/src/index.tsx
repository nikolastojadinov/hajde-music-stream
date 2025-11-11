import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import 'normalize.css';
import './defaults.css';
import PiAuth from './components/PiAuth';
import { testConnection } from './utils/connectionTest';

function Root() {
  useEffect(() => {
    testConnection();
  }, []);
  return (
    <React.StrictMode>
      <PiAuth />
    </React.StrictMode>
  );
}

ReactDOM.render(<Root />, document.getElementById('root'));