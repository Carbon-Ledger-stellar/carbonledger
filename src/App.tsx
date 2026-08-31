import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuditPage } from './pages/AuditPage';

const theme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#2E7D32',
        },
        secondary: {
            main: '#1976D2',
        },
    },
});

function App() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<AuditPage />} />
                    <Route path="/audit" element={<AuditPage />} />
                </Routes>
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;
