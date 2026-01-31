// TiTiler configuration
export interface TiTilerConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
}

const config: TiTilerConfig = {
  baseUrl: process.env.TITILER_URL || 'http://localhost:8000',
  timeout: parseInt(process.env.TITILER_TIMEOUT || '5000', 10),
  retries: parseInt(process.env.TITILER_RETRIES || '3', 10),
};

export default config;