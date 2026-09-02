import React, { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser, loginUser, logoutUser, registerUser, User } from '../services/auth.service';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    getCurrentUser()
      .then((currentUser) => {
        if (isMounted) {
          setUser(currentUser);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setUser(null);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    const loggedUser = await loginUser(email, password);
    setUser(loggedUser);
  };

  const register = async (name: string, email: string, password: string): Promise<void> => {
    const newUser = await registerUser(name, email, password);
    setUser(newUser);
  };

  const logout = async (): Promise<void> => {
    await logoutUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        user,
        loading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
