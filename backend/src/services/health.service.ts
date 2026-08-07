export interface HealthStatus {
  status: string;
  uptime: number;
  timestamp: string;
}

export interface RootServiceInfo {
  service: string;
  version: string;
  status: string;
}

export class HealthService {
  public getRootInfo(): RootServiceInfo {
    return {
      service: 'UIVerdict Backend',
      version: 'v1',
      status: 'running',
    };
  }

  public getHealthStatus(): HealthStatus {
    return {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}

export const healthService = new HealthService();
