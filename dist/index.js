import * as jsondiffpatch from 'jsondiffpatch';
import * as semver from 'semver';
const historyPlugin = (options) => {
    const pluginOptions = {
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
    const Schema = new mongoose.Schema({
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
    }, {
        collection: pluginOptions.modelName
    });
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
        this[pluginOptions.timestampFieldName] = new Date();
        next();
    });
    const HistoryModel = mongoose.model(pluginOptions.modelName, Schema);
    const getModelName = (defaultName) => {
        return pluginOptions.embeddedDocument ? pluginOptions.embeddedModelName : defaultName;
    };
    const jdf = jsondiffpatch.create({
        objectHash: function (obj, index) {
            if (obj !== undefined) {
                return ((obj._id && obj._id.toString()) ||
                    obj.id ||
                    obj.key ||
                    '$$index:' + index);
            }
            return '$$index:' + index;
        },
        arrays: {
            detectMove: true
        }
    });
    const queryHistory = (method = 'find', options = {}) => {
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
    return function (schema) {
        schema.add({
            __history: { type: mongoose.Schema.Types.Mixed }
        });
        const preSave = function (forceSave) {
            return function (next) {
                if (this.__history !== undefined || pluginOptions.noEventSave) {
                    let getPrevious;
                    if (pluginOptions.embeddedDocument) {
                        getPrevious = this.getVersions().then((versions) => {
                            if (versions.length)
                                return versions[versions.length - 1].object || {};
                            else
                                return {};
                        }).catch(() => {
                            return {};
                        });
                    }
                    else {
                        const Constructor = this.constructor;
                        getPrevious = Constructor.findById(this._id).lean().exec();
                    }
                    getPrevious
                        .then((previous) => {
                        // Use toObject to exclude virtuals from the diff
                        const currentObject = this.toObject({ virtuals: false });
                        const previousObject = previous || {};
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
                            const method = this.__history[pluginOptions.methodFieldName];
                            if (method && pluginOptions.noDiffSaveOnMethods.includes(method)) {
                                saveWithoutDiff = true;
                                if (forceSave) {
                                    currentDiff = previousObject;
                                }
                            }
                        }
                        if (currentDiff || pluginOptions.noDiffSave || saveWithoutDiff) {
                            const Constructor = this.constructor;
                            return HistoryModel.findOne({
                                collectionName: getModelName(Constructor.modelName),
                                collectionId: this._id
                            })
                                .sort('-' + pluginOptions.timestampFieldName)
                                .select({ version: 1 })
                                .then((lastHistory) => {
                                const obj = {};
                                obj.collectionName = getModelName(Constructor.modelName);
                                obj.collectionId = this._id;
                                obj.diff = currentDiff || {};
                                if (this.__history) {
                                    obj.event = this.__history.event;
                                    obj[pluginOptions.userFieldName] = this.__history[pluginOptions.userFieldName];
                                    const docWithAccount = this;
                                    obj[pluginOptions.accountFieldName] =
                                        docWithAccount[pluginOptions.accountFieldName] ||
                                            this.__history[pluginOptions.accountFieldName];
                                    obj.reason = this.__history.reason;
                                    obj.data = this.__history.data;
                                    obj[pluginOptions.methodFieldName] = this.__history[pluginOptions.methodFieldName];
                                }
                                let version = null;
                                if (lastHistory) {
                                    const type = this.__history && this.__history.type
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
        schema.methods.getDiffs = function (options = {}) {
            options.find = options.find || {};
            const Constructor = this.constructor;
            Object.assign(options.find, {
                collectionName: getModelName(Constructor.modelName),
                collectionId: this._id
            });
            options.sort = options.sort || '-' + pluginOptions.timestampFieldName;
            return queryHistory('find', options);
        };
        schema.methods.getDiff = function (version, options = {}) {
            options.find = options.find || {};
            const Constructor = this.constructor;
            Object.assign(options.find, {
                collectionName: getModelName(Constructor.modelName),
                collectionId: this._id,
                version: version
            });
            options.sort = options.sort || '-' + pluginOptions.timestampFieldName;
            return queryHistory('findOne', options);
        };
        schema.methods.getVersion = function (version2get, includeObject = true) {
            return this.getDiffs({ sort: pluginOptions.timestampFieldName }).then((histories) => {
                if (histories.length === 0) {
                    return Promise.reject(new Error('No history found for this document'));
                }
                const firstVersion = histories[0];
                const lastVersion = histories[histories.length - 1];
                let history;
                let currentVersion = {};
                if (semver.gt(version2get, lastVersion.version)) {
                    version2get = lastVersion.version;
                }
                if (semver.lt(version2get, firstVersion.version)) {
                    version2get = firstVersion.version;
                }
                histories.forEach((item) => {
                    if (item.version === version2get) {
                        history = item;
                    }
                });
                if (!includeObject) {
                    return history;
                }
                histories.forEach((item) => {
                    if (semver.lt(item.version, version2get) ||
                        item.version === version2get) {
                        currentVersion = jdf.patch(currentVersion, item.diff);
                    }
                });
                const result = history;
                delete result.diff;
                result.object = currentVersion;
                return result;
            });
        };
        schema.methods.compareVersions = function (versionLeft, versionRight) {
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
        schema.methods.getVersions = function (options = {}, includeObject = true) {
            options.sort = options.sort || pluginOptions.timestampFieldName;
            return this.getDiffs(options).then((histories) => {
                if (!includeObject) {
                    return histories;
                }
                let currentVersion = {};
                const results = [];
                for (let i = 0; i < histories.length; i++) {
                    currentVersion = jdf.patch(currentVersion, histories[i].diff);
                    const historyResult = histories[i];
                    historyResult.object = jdf.clone(currentVersion);
                    delete historyResult.diff;
                    results.push(historyResult);
                }
                return results;
            });
        };
    };
};
export default historyPlugin;
//# sourceMappingURL=index.js.map