import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import AdminRoute from '@/components/AdminRoute';
// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
// App pages
import Home from '@/pages/Home';
import NewDelivery from '@/pages/NewDelivery';
import BillEntries from '@/pages/BillEntries';
import CratesEntries from '@/pages/CratesEntries';
import Dashboard from '@/pages/Dashboard';
import DailyProduction from '@/pages/DailyProduction';
import DataAnalytics from '@/pages/DataAnalytics';
import Customers from '@/pages/Customers';
import Settings from '@/pages/Settings';
import LocationTracking from '@/pages/LocationTracking';
import Orders from '@/pages/Orders';
import DailySummaryPage from '@/pages/DailySummary';
import SplashScreen from '@/components/SplashScreen';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError && authError.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DailySummaryPage />} />
          <Route path="/new-delivery" element={<NewDelivery />} />
          <Route path="/bill-entries" element={<BillEntries />} />
          <Route path="/crates-entries" element={<CratesEntries />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/daily-summary" element={<DailySummaryPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/daily-production" element={<DailyProduction />} />
          <Route path="/data-analytics" element={<DataAnalytics />} />
          <Route path="/customers" element={<AdminRoute><Customers /></AdminRoute>} />
          <Route path="/location-tracking" element={<AdminRoute><LocationTracking /></AdminRoute>} />
          <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <SplashScreen />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App