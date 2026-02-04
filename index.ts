import * as jsondiffpatch from 'jsondiffpatch';
import * as semver from 'semver';
import { Mongoose, Schema as MongooseSchema, Model, Document, Query } from 'mongoose';

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

type PartialPluginOptions = Partial<Omit<PluginOptions, 'mongoose'>> & { mongoose: Mongoose };

const historyPlugin = (options: PartialPluginOptions) => {
  const pluginOptions: PluginOptions = {
    modelName: options.modelName ?? '__histories',
    embeddedDocument: options.embeddedDocument ?? false,
    embeddedModelName: options.embeddedModelName ?? '',
    userCollection: options.userCollection ?? 'users',
    accountCollection: options.accountCollection ?? 'accounts',
    userFieldName: options.userFieldName ?? 'user',
    accountFieldName: options.accountFieldName ?? 'account',
    timestampFieldName: options.timestampFieldName ?? 'timestamp',
    methodFieldName: options.methodFieldName ?? 'method',
    ignore: options.ignore ?? [],
    noDiffSave: options.noDiffSave ?? false,
    noDiffSaveOnMethods: options.noDiffSaveOnMethods ?? [],
    noEventSave: options.noEventSave ?? true,
    mongoose: options.mongoose
  };

  const mongoose = pluginOptions.mongoose;

  const Schema = new mongoose.Schema(
    {
      collectionName: String,
      collectionId: { type: mongoose.Schema.Types.ObjectId },
      diff: {},
      event: String,
      reason: String,
      data: { type: mongoose.Schema.Types.Mixed },
      [pluginOptions.userFieldName]: {
        type: mongoose.Schema.Types.ObjectId,
        ref: pluginOptions.userCollection
      },
      [pluginOptions.accountFieldName]: {
        type: mongoose.Schema.Types.ObjectId,
        ref: pluginOptions.accountCollection
      },
      version: { type: String, default: '0.0.0' },
      [pluginOptions.timestampFieldName]: Date,
      [pluginOptions.methodFieldName]: String
    },
    {
      collection: pluginOptions.modelName
    }
  );

  Schema.set('minimize', false);
  Schema.set('versionKey', false);
  Schema.set('strict', true);

  Schema.index({
    collectionName: 1,
    collectionId: 1,
    [pluginOptions.timestampFieldName]: -1
  });

  Schema.index({
    collectionName: 1,
    collectionId: 1,
    version: 1
  });

  Schema.pre('save', function (next) {
    (this as unknown as Record<string, unknown>)[pluginOptions.timestampFieldName] = new Date();
    next();
  });

  const HistoryModel: Model<HistoryDocument> = mongoose.model<HistoryDocument>(pluginOptions.modelName, Schema);

  const getModelName = (defaultName: string): string => {
    return pluginOptions.embeddedDocument ? pluginOptions.embeddedModelName : defaultName;
  };

  const jdf = jsondiffpatch.create({
    objectHash: function (obj: any, index?: number): string | undefined {
      if (obj !== undefined) {
        return (
          (obj._id && obj._id.toString()) ||
          obj.id ||
          obj.key ||
          '$$index:' + index
        );
      }

      return '$$index:' + index;
    },
    arrays: {
      detectMove: true
    }
  });

  const queryHistory = (method: 'find' | 'findOne' = 'find', options: QueryOptions = {}): Query<any, HistoryDocument> => {
    const filter = options.find || {};
    const queryBuilder = method === 'find' 
      ? HistoryModel.find(filter)
      : HistoryModel.findOne(filter);

    if (options.select !== undefined) {
      Object.assign(options.select, {
        _id: 0,
        collectionId: 0,
        collectionName: 0
      });

      queryBuilder.select(options.select);
    }

    if (options.sort) {
      queryBuilder.sort(options.sort);
    }
    if (options.populate) {
      queryBuilder.populate(options.populate);
    }
    if (options.limit) {
      queryBuilder.limit(options.limit);
    }

    return queryBuilder.lean();
  };

  return function (schema: MongooseSchema) {
    schema.add({
      __history: { type: mongoose.Schema.Types.Mixed }
    });

    const preSave = function (forceSave: boolean) {
      return function (this: HistoryEnabledDocument, next: (err?: Error) => void): void {
        if (this.__history !== undefined || pluginOptions.noEventSave) {
          let getPrevious: Promise<Record<string, unknown> | null>;
          if (pluginOptions.embeddedDocument) {
            getPrevious = this.getVersions().then((versions: VersionResult[]) => {
              if (versions.length) return versions[versions.length - 1].object || {};
              else return {};
            }).catch(() => {
              return {};
            });
          } else {
            const Constructor = this.constructor as Model<HistoryEnabledDocument>;
            getPrevious = Constructor.findById(this._id).lean().exec() as Promise<Record<string, unknown> | null>;
          }

          getPrevious
            .then((previous) => {
              const currentObject = JSON.parse(JSON.stringify(this)) as Record<string, unknown>;
              const previousObject: Record<string, unknown> = previous
                ? JSON.parse(JSON.stringify(previous))
                : {};

              delete currentObject.__history;
              delete previousObject.__history;
              delete currentObject.__v;
              delete previousObject.__v;

              for (const field of pluginOptions.ignore) {
                delete currentObject[field];
                delete previousObject[field];
              }

              let currentDiff = jdf.diff(previousObject, currentObject);

              let saveWithoutDiff = false;
              if (this.__history && pluginOptions.noDiffSaveOnMethods.length) {
                const method = this.__history[pluginOptions.methodFieldName] as string | undefined;
                if (method && pluginOptions.noDiffSaveOnMethods.includes(method)) {
                  saveWithoutDiff = true;
                  if (forceSave) {
                    currentDiff = previousObject as any;
                  }
                }
              }

              if (currentDiff || pluginOptions.noDiffSave || saveWithoutDiff) {
                const Constructor = this.constructor as Model<HistoryEnabledDocument>;
                return HistoryModel.findOne({
                  collectionName: getModelName(Constructor.modelName),
                  collectionId: this._id
                })
                  .sort('-' + pluginOptions.timestampFieldName)
                  .select({ version: 1 })
                  .then((lastHistory) => {
                    const obj: Record<string, unknown> = {};
                    obj.collectionName = getModelName(Constructor.modelName);
                    obj.collectionId = this._id;
                    obj.diff = currentDiff || {};

                    if (this.__history) {
                      obj.event = this.__history.event;
                      obj[pluginOptions.userFieldName] = this.__history[
                        pluginOptions.userFieldName
                      ];
                      const docWithAccount = this as unknown as Record<string, unknown>;
                      obj[pluginOptions.accountFieldName] =
                        docWithAccount[pluginOptions.accountFieldName] ||
                        this.__history[pluginOptions.accountFieldName];
                      obj.reason = this.__history.reason;
                      obj.data = this.__history.data;
                      obj[pluginOptions.methodFieldName] = this.__history[
                        pluginOptions.methodFieldName
                      ];
                    }

                    let version: string | null = null;

                    if (lastHistory) {
                      const type =
                        this.__history && this.__history.type
                          ? this.__history.type
                          : 'major';

                      version = semver.inc(lastHistory.version, type);
                    }

                    obj.version = version || '0.0.0';
                    for (const key in obj) {
                      if (obj[key] === undefined) {
                        delete obj[key];
                      }
                    }

                    const history = new HistoryModel(obj);

                    this.__history = undefined;
                    return history.save();
                  });
              }
              return undefined;
            })
            .then(() => next())
            .catch(next);
          return;
        }

        next();
      };
    };

    schema.pre('save', preSave(false));

    schema.pre('deleteOne', { document: true, query: false }, preSave(true));

    schema.methods.getDiffs = function (this: HistoryEnabledDocument, options: QueryOptions = {}): Promise<HistoryDocument[]> {
      options.find = options.find || {};
      const Constructor = this.constructor as Model<HistoryEnabledDocument>;
      Object.assign(options.find, {
        collectionName: getModelName(Constructor.modelName),
        collectionId: this._id
      });

      options.sort = options.sort || '-' + pluginOptions.timestampFieldName;
      return queryHistory('find', options);
    };

    schema.methods.getDiff = function (this: HistoryEnabledDocument, version: string, options: QueryOptions = {}): Promise<HistoryDocument | null> {
      options.find = options.find || {};
      const Constructor = this.constructor as Model<HistoryEnabledDocument>;
      Object.assign(options.find, {
        collectionName: getModelName(Constructor.modelName),
        collectionId: this._id,
        version: version
      });

      options.sort = options.sort || '-' + pluginOptions.timestampFieldName;

      return queryHistory('findOne', options);
    };

    schema.methods.getVersion = function (this: HistoryEnabledDocument, version2get: string, includeObject = true): Promise<VersionResult> {
      return this.getDiffs({ sort: pluginOptions.timestampFieldName }).then((histories) => {
        const firstVersion = histories[0];
        const lastVersion = histories[histories.length - 1];
        let history: VersionResult | undefined;
        let currentVersion: Record<string, unknown> = {};

        if (semver.gt(version2get, lastVersion.version)) {
          version2get = lastVersion.version;
        }

        if (semver.lt(version2get, firstVersion.version)) {
          version2get = firstVersion.version;
        }

        histories.forEach((item) => {
          if (item.version === version2get) {
            history = item as unknown as VersionResult;
          }
        });

        if (!includeObject) {
          return history as VersionResult;
        }

        histories.forEach((item) => {
          if (
            semver.lt(item.version, version2get) ||
            item.version === version2get
          ) {
            currentVersion = jdf.patch(currentVersion, item.diff) as Record<string, unknown>;
          }
        });

        const result = history as VersionResult;
        delete result.diff;
        result.object = currentVersion;

        return result;
      });
    };

    schema.methods.compareVersions = function (this: HistoryEnabledDocument, versionLeft: string, versionRight: string): Promise<CompareResult> {
      return this.getVersion(versionLeft).then((versionLeftResult) => {
        return this.getVersion(versionRight).then((versionRightResult) => {
          return {
            diff: jdf.diff(versionLeftResult.object || {}, versionRightResult.object || {}),
            left: versionLeftResult.object || {},
            right: versionRightResult.object || {}
          };
        });
      });
    };

    schema.methods.getVersions = function (this: HistoryEnabledDocument, options: QueryOptions = {}, includeObject = true): Promise<VersionResult[]> {
      options.sort = options.sort || pluginOptions.timestampFieldName;

      return this.getDiffs(options).then((histories) => {
        if (!includeObject) {
          return histories as unknown as VersionResult[];
        }

        let currentVersion: Record<string, unknown> = {};
        const results: VersionResult[] = [];
        for (let i = 0; i < histories.length; i++) {
          currentVersion = jdf.patch(currentVersion, histories[i].diff) as Record<string, unknown>;
          const historyResult = histories[i] as unknown as VersionResult;
          historyResult.object = jdf.clone(currentVersion) as Record<string, unknown>;
          delete historyResult.diff;
          results.push(historyResult);
        }

        return results;
      });
    };
  };
};

export default historyPlugin;
export { PluginOptions, HistoryDocument, HistoryEnabledDocument, QueryOptions, VersionResult, CompareResult, HistoryMetadata };
