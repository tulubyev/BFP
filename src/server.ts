import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

import titilerRoutes from './routes/titiler';
import stacRoutes from './routes/stac';
import analyticsRoutes from './routes/analytics';

class Server {
  private app: Application;
  private port: number;
  private host: string;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '5000', 10);
    this.host = '0.0.0.0';
    this.initializeMiddlewares();
    this.initializeRoutes();
  }

  private initializeMiddlewares(): void {
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com"],
          fontSrc: ["'self'", "fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"]
        }
      }
    }));
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  private initializeRoutes(): void {
    this.app.use('/api/titiler', titilerRoutes);
    this.app.use('/api/stac', stacRoutes);
    this.app.use('/api/analytics', analyticsRoutes);
    
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
    
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
    });
  }

  public listen(): void {
    this.app.listen(this.port, this.host, () => {
      console.log(`Server running on http://${this.host}:${this.port}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  }
}

const server = new Server();
server.listen();

export default Server;