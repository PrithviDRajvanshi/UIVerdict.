import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export const LoginForm: React.FC = () => {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data: LoginFormData) => {
    // Frontend mock login authentication trigger
    navigate('/dashboard');
  };

  return (
    <div className="w-full max-w-md bg-[#151515] border border-[#2a2a2a] p-8">
      <div className="mb-6 text-center">
        <h2 className="font-headline-lg text-headline-lg uppercase text-primary mb-2">ANALYST AUTHENTICATION</h2>
        <p className="font-mono-data text-mono-data text-[#888888]">Enter security credentials to access platform</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <label className="block font-label-sm text-label-sm uppercase text-[#888888] mb-2">Email Address</label>
          <input
            {...register('email')}
            type="email"
            placeholder="analyst@uiverdict.io"
            className="tech-input w-full p-3 font-body-md text-primary bg-[#090909] border-[#2a2a2a]"
          />
          {errors.email && <span className="text-[#ffb4ab] text-xs mt-1 block">{errors.email.message}</span>}
        </div>

        <div>
          <label className="block font-label-sm text-label-sm uppercase text-[#888888] mb-2">Security Key / Password</label>
          <input
            {...register('password')}
            type="password"
            placeholder="••••••••"
            className="tech-input w-full p-3 font-body-md text-primary bg-[#090909] border-[#2a2a2a]"
          />
          {errors.password && <span className="text-[#ffb4ab] text-xs mt-1 block">{errors.password.message}</span>}
        </div>

        <button
          type="submit"
          className="tech-button w-full py-3 mt-4 font-headline-md text-headline-md uppercase tracking-wider bg-primary text-[#090909] cursor-pointer"
        >
          AUTHENTICATE
        </button>
      </form>

      <div className="mt-6 text-center font-mono-data text-mono-data text-[#888888]">
        Need access?{' '}
        <Link to="/register" className="text-primary underline">
          Request System Access
        </Link>
      </div>
    </div>
  );
};
