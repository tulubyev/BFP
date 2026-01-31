import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

// Import routes
import titilerRoutes from '@/routes/titiler';
import stacRoutes from '@/routes/stac';
import analyticsRoutes from '@/routes/analytics';

class Server {
  private app: Application;
  private port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3000', 10);
    this.initializeMiddlewares();
    this.initializeRoutes();
  }

  private initializeMiddlewares(): void {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  private initializeRoutes(): void {
    this.app.use('/api/titiler', titilerRoutes);
    this.app.use('/api/stac', stacRoutes);
    this.app.use('/api/analytics', analyticsRoutes);
    
    // Serve frontend
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
    
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
    });
  }

  public listen(): void {
    this.app.listen(this.port, () => {
      console.log(`🚀 Server running on port ${this.port}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  }
}

const server = new Server();
server.listen();

export default Server;