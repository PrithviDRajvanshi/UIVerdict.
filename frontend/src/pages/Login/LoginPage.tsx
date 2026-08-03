import React from 'react';
import { LoginForm } from '../../components/forms/LoginForm';

export const LoginPage: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-margin-desktop">
      <LoginForm />
    </div>
  );
};
