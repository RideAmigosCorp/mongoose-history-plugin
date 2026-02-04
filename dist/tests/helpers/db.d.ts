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
declare const _default: (mongoose: Mongoose) => DbHelper;
export default _default;
//# sourceMappingURL=db.d.ts.map