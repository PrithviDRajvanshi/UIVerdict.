import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'tech';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'tech',
  className = '',
  children,
  ...props
}) => {
  if (variant === 'primary') {
    return (
      <button
        className={`px-8 py-4 bg-brand-dark hover:bg-primary hover:text-brand-dark text-primary font-headline-md text-headline-md uppercase tracking-wider transition-colors duration-200 border-none flex items-center justify-center group whitespace-nowrap ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      className={`tech-button font-label-sm text-label-sm px-4 py-2 hover:bg-primary hover:text-brand-dark transition-colors duration-200 uppercase tracking-widest bg-brand-dark text-primary ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
