import { Mongoose, Schema as MongooseSchema, Document } from 'mongoose';
interface PluginOptions {
    modelName: string;
    embeddedDocument: boolean;
    embeddedModelName: string;
    userCollection: string;
    accountCollection: string;
    userFieldName: string;
    accountFieldName: string;
    timestampFieldName: string;
    methodFieldName: string;
    ignore: string[];
    noDiffSave: boolean;
    noDiffSaveOnMethods: string[];
    noEventSave: boolean;
    mongoose: Mongoose;
}
interface HistoryMetadata {
    event?: string;
    type?: 'major' | 'minor' | 'patch';
    reason?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
}
interface HistoryDocument extends Document {
    collectionName: string;
    collectionId: MongooseSchema.Types.ObjectId;
    diff: any;
    event?: string;
    reason?: string;
    data?: Record<string, unknown>;
    version: string;
    [key: string]: unknown;
}
interface QueryOptions {
    find?: Record<string, unknown>;
    select?: Record<string, number>;
    sort?: string;
    populate?: any;
    limit?: number;
}
interface VersionResult {
    version: string;
    object?: Record<string, unknown>;
    diff?: any;
    [key: string]: unknown;
}
interface CompareResult {
    diff: any;
    left: Record<string, unknown>;
    right: Record<string, unknown>;
}
interface HistoryEnabledDocument extends Document {
    __history?: HistoryMetadata;
    getDiffs(options?: QueryOptions): Promise<HistoryDocument[]>;
    getDiff(version: string, options?: QueryOptions): Promise<HistoryDocument | null>;
    getVersion(version: string, includeObject?: boolean): Promise<VersionResult>;
    compareVersions(versionLeft: string, versionRight: string): Promise<CompareResult>;
    getVersions(options?: QueryOptions, includeObject?: boolean): Promise<VersionResult[]>;
}
type PartialPluginOptions = Partial<Omit<PluginOptions, 'mongoose'>> & {
    mongoose: Mongoose;
};
declare const historyPlugin: (options: PartialPluginOptions) => (schema: MongooseSchema) => void;
export default historyPlugin;
export { PluginOptions, HistoryDocument, HistoryEnabledDocument, QueryOptions, VersionResult, CompareResult, HistoryMetadata };
//# sourceMappingURL=index.d.ts.map