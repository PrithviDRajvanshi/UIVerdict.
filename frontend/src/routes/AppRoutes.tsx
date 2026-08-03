import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainLayout } from '../layouts/MainLayout';
import { HomePage } from '../pages/Home/HomePage';
import { DashboardPage } from '../pages/Dashboard/DashboardPage';
import { AnalysisPage } from '../pages/Analysis/AnalysisPage';
import { ReportPage } from '../pages/Report/ReportPage';
import { HistoryPage } from '../pages/History/HistoryPage';
import { SavedReportsPage } from '../pages/SavedReports/SavedReportsPage';
import { LoginPage } from '../pages/Login/LoginPage';
import { RegisterPage } from '../pages/Register/RegisterPage';
import { NotFoundPage } from '../pages/NotFound/NotFoundPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/report/:id" element={<ReportPage />} />
        <Route path="/archive" element={<HistoryPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/saved-reports" element={<SavedReportsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};
