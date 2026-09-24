import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

import titilerRoutes from './routes/titiler';
import stacRoutes from './routes/stac';
import analyticsRoutes from './routes/analytics';
import monitoringRoutes from './routes/monitoring';
import externalRoutes from './routes/external';
import tileRoutes from './routes/tiles';
import { startRefreshJobs } from './jobs/refresh';

/** Origin of the CDN serving built assets, as a CSP source list (empty when unset). */
function cdnOrigin(url: string | undefined): string[] {
  if (!url) return [];
  try {
    return [new URL(url).origin];
  } catch {
    console.warn(`Ignoring invalid CDN_URL: ${url}`);
    return [];
  }
}

class Server {
  private app: Application;
  private port: number;
  private host: string;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3000', 10);
    this.host = '0.0.0.0';
    this.initializeMiddlewares();
    this.initializeRoutes();
  }

  private initializeMiddlewares(): void {
    // Optional CDN origin for built assets (e.g. https://cdn.forestwatch.ru); empty = same origin
    const cdn = cdnOrigin(process.env.CDN_URL);
    this.app.use(compression());
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", ...cdn],
          styleSrc: ["'self'", "'unsafe-inline'", ...cdn],
          fontSrc: ["'self'", ...cdn],
          // Basemaps load directly; GFW tiles go through /tiles (same origin or CDN)
          imgSrc: ["'self'", "data:", "blob:", ...cdn, "tile.openstreetmap.org", "server.arcgisonline.com"],
          connectSrc: ["'self'", ...cdn],
        }
      },
      // Assets, boundary files and tiles are also requested from the CDN origin
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public'), {
      setHeaders: (res, filePath) => {
        // Vite assets carry a content hash, boundary files a version — safe to cache forever (browser + CDN)
        if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.includes(`${path.sep}boundaries${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
  }

  private initializeRoutes(): void {
    this.app.use('/api/titiler', titilerRoutes);
    this.app.use('/api/stac', stacRoutes);
    this.app.use('/api/analytics', analyticsRoutes);
    this.app.use('/api/monitoring', monitoringRoutes);
    this.app.use('/api/external', externalRoutes);
    this.app.use('/tiles', tileRoutes);
    
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../public/index.html'), { headers: { 'Cache-Control': 'no-cache' } });
    });
    
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
    });

    // SPA fallback: client-side routes (/analytics, /wiki, /incidents) → index.html
    this.app.get(/^\/(?!api\/|tiles\/).*/, (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../public/index.html'), { headers: { 'Cache-Control': 'no-cache' } });
    });
  }

  public listen(): void {
    this.app.listen(this.port, this.host, () => {
      console.log(`Server running on http://${this.host}:${this.port}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      // Background refresh only makes sense with a shared cache to fill
      if (process.env.REDIS_URL) startRefreshJobs();
    });
  }
}

const server = new Server();
server.listen();

export default Server;