import React from 'react';
import { RegisterForm } from '../../components/forms/RegisterForm';

export const RegisterPage: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-margin-desktop">
      <RegisterForm />
    </div>
  );
};
