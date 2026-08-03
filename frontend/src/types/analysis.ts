export interface MetricOverview {
  title: string;
  score: number;
  maxScore: number;
  subtitle: string;
  icon: string;
}

export interface ProtocolItem {
  number: string;
  title: string;
  description: string;
  tags: string[];
}

export interface AnalysisOverviewData {
  systemStatus: string;
  version: string;
  metricsOverview: MetricOverview[];
  protocols: ProtocolItem[];
}
