import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../frontend/src/auth/AuthContext.jsx';
import App from '../../frontend/src/App.jsx';
import '../../frontend/src/styles.css';
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter>);
