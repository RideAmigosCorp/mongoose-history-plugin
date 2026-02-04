import MongooseHistoryPlugin from '../../index.js';
import { Mongoose } from 'mongoose';

interface DbHelperOptions {
  log: (message: string) => void;
}

interface DbHelper {
  dbname: string;
  MongooseHistoryPlugin: typeof MongooseHistoryPlugin;
  connectionString: string;
  getRandomName: () => string;
  start: (options: DbHelperOptions) => Promise<void>;
  close: () => Promise<void>;
  dropCollection: (name: string) => Promise<void>;
  dropCollections: () => Promise<void>;
}

const getRandomName = (): string => (0 | (Math.random() * 9e6)).toString(36);

export default (mongoose: Mongoose): DbHelper => {
  const dbname = getRandomName();
  const connectionString = `mongodb://localhost:27017/${dbname}`;

  return {
    dbname,
    MongooseHistoryPlugin,
    connectionString,
    getRandomName,
    async start({ log }: DbHelperOptions): Promise<void> {
      await mongoose.connect(connectionString);
      log(`Mongoose listening on port 27017 to database "${dbname}"`);
    },
    async close(): Promise<void> {
      if (mongoose.connection.db) {
        await mongoose.connection.db.dropDatabase();
      }
      await mongoose.connection.close();
    },
    async dropCollection(name: string): Promise<void> {
      try {
        if (mongoose.connection.db) {
          await mongoose.connection.db.dropCollection(name);
        }
      } catch (error) {
        if (error instanceof Error && error.message !== 'ns not found') {
          throw error;
        }
      }
    },
    async dropCollections(): Promise<void> {
      const collections = Object.keys(mongoose.connection.collections);

      for (const name of collections) {
        try {
          await mongoose.connection.collections[name].drop();
        } catch (error) {
          if (error instanceof Error && error.message !== 'ns not found') {
            throw error;
          }
        }
      }
    }
  };
};
