import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { WalletProvider } from './context/WalletContext';
import { Header } from './components/layout/Header';
import { DashboardPage } from './pages/DashboardPage';
import { RetirementPage } from './pages/RetirementPage';
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
            <WalletProvider>
                <BrowserRouter>
                    <Header />
                    <Routes>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/retirement" element={<RetirementPage />} />
                        <Route path="/audit" element={<AuditPage />} />
                    </Routes>
                </BrowserRouter>
            </WalletProvider>
        </ThemeProvider>
    );
}

export default App;
