import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose, { Schema, Model, Types } from 'mongoose';
import DbHelper from './helpers/db.js';
import { HistoryEnabledDocument } from '../index.js';

interface TankDocument extends HistoryEnabledDocument {
  name?: string;
  size?: string;
}

interface EmbeddedTankDocument extends HistoryEnabledDocument {
  name?: string;
  size?: string;
}

interface ParentDocument extends HistoryEnabledDocument {
  tanks: Types.DocumentArray<EmbeddedTankDocument>;
}

const { start, close, MongooseHistoryPlugin } = DbHelper(mongoose);

// Default options
const options = {
  userCollection: 'users',
  accountCollection: 'accounts',
  userFieldName: 'user',
  accountFieldName: 'account',
  timestampFieldName: 'timestamp',
  methodFieldName: 'method',
  ignore: [],
  noDiffSave: false,
  noDiffSaveOnMethods: ['delete'],
  noEventSave: true,
  modelName: '__histories',
  mongoose: mongoose
};

const HistoryPlugin = MongooseHistoryPlugin(options);

const CompiledSchema = new Schema<TankDocument>({ name: String, size: String });
CompiledSchema.plugin(HistoryPlugin);

const embeddedOptionDefaults = { embeddedDocument: true, embeddedModelName: 'EmbeddedCollection', modelName: '__embedded_histories' };
const embeddedOptions = Object.assign({}, options, embeddedOptionDefaults);
const EmbeddedSchema = new Schema<EmbeddedTankDocument>({ name: String, size: String });
EmbeddedSchema.plugin(MongooseHistoryPlugin(embeddedOptions));

describe('Mongoose History Plugin', () => {
  before(async () => {
    await start({ log: console.log });
  });

  after(async () => {
    await close();
  });

  test('should add the plugin to a schema', async () => {
    const TestSchema = new Schema<TankDocument>({ name: String, size: String });

    // Track if plugin was called
    let pluginCalled = false;
    const wrappedPlugin = (schema: Schema) => {
      pluginCalled = true;
      return HistoryPlugin(schema);
    };

    assert.strictEqual(pluginCalled, false);

    TestSchema.plugin(wrappedPlugin);

    assert.strictEqual(pluginCalled, true);
    // Verify the plugin added the expected methods
    assert.strictEqual(typeof TestSchema.methods.getDiffs, 'function');
  });

  test('should test methods added to the schema', async () => {
    const TestSchema = new Schema<TankDocument>({ name: String, size: String });
    TestSchema.plugin(HistoryPlugin);

    assert.strictEqual(typeof TestSchema.methods.getDiffs, 'function');
    assert.strictEqual(typeof TestSchema.methods.getDiff, 'function');
    assert.strictEqual(typeof TestSchema.methods.getVersion, 'function');
    assert.strictEqual(typeof TestSchema.methods.getVersions, 'function');
    assert.strictEqual(typeof TestSchema.methods.compareVersions, 'function');
  });

  test('should test methods added to the model', async () => {
    const Tank: Model<TankDocument> = mongoose.model<TankDocument>('tank', CompiledSchema);
    const small = new Tank({
      size: 'small'
    });

    assert.strictEqual(typeof small.getDiffs, 'function');
    assert.strictEqual(typeof small.getDiff, 'function');
    assert.strictEqual(typeof small.getVersion, 'function');
    assert.strictEqual(typeof small.getVersions, 'function');
    assert.strictEqual(typeof small.compareVersions, 'function');
  });

  test('should create history when save', async () => {
    const Tank: Model<TankDocument> = mongoose.model<TankDocument>('tank', CompiledSchema);
    const small = new Tank({
      size: 'small'
    });

    await small.save();
    const diffs = await small.getDiffs();

    assert.strictEqual(diffs.length, 1);
    assert.ok(diffs[0]._id);
    assert.strictEqual(diffs[0].version, '0.0.0');
    assert.strictEqual(diffs[0].collectionName, 'tank');
    assert.deepStrictEqual(diffs[0].collectionId, small._id);
    assert.deepStrictEqual(diffs[0].diff, { _id: [String(small._id)], size: ['small'] });
    assert.ok(diffs[0].timestamp instanceof Date);
  });

  test('should create history when save a change', async () => {
    const Tank: Model<TankDocument> = mongoose.model<TankDocument>('tank', CompiledSchema);
    const small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    const diffs = await small.getDiffs();

    assert.strictEqual(diffs.length, 2);

    assert.ok(diffs[0]._id);
    assert.strictEqual(diffs[0].version, '1.0.0');
    assert.strictEqual(diffs[0].collectionName, 'tank');
    assert.deepStrictEqual(diffs[0].collectionId, small._id);
    assert.deepStrictEqual(diffs[0].diff, { size: ['small', 'large'] });
    assert.ok(diffs[0].timestamp instanceof Date);

    assert.ok(diffs[1]._id);
    assert.strictEqual(diffs[1].version, '0.0.0');
    assert.strictEqual(diffs[1].collectionName, 'tank');
    assert.deepStrictEqual(diffs[1].collectionId, small._id);
    assert.deepStrictEqual(diffs[1].diff, { _id: [String(small._id)], size: ['small'] });
    assert.ok(diffs[1].timestamp instanceof Date);
  });

  test('should get a diff by version', async () => {
    const Tank: Model<TankDocument> = mongoose.model<TankDocument>('tank', CompiledSchema);
    const small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    const diffs = await small.getDiff('1.0.0');

    assert.ok(diffs);
    assert.ok(diffs._id);
    assert.strictEqual(diffs.version, '1.0.0');
    assert.strictEqual(diffs.collectionName, 'tank');
    assert.deepStrictEqual(diffs.collectionId, small._id);
    assert.deepStrictEqual(diffs.diff, { size: ['small', 'large'] });
    assert.ok(diffs.timestamp instanceof Date);
  });

  test('should get all versions', async () => {
    const Tank: Model<TankDocument> = mongoose.model<TankDocument>('tank', CompiledSchema);
    const small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    const versions = await small.getVersions();

    assert.strictEqual(versions.length, 2);

    assert.ok(versions[0]._id);
    assert.strictEqual(versions[0].version, '0.0.0');
    assert.strictEqual(versions[0].collectionName, 'tank');
    assert.deepStrictEqual(versions[0].collectionId, small._id);
    assert.deepStrictEqual(versions[0].object, { _id: String(small._id), size: 'small' });
    assert.ok(versions[0].timestamp instanceof Date);

    assert.ok(versions[1]._id);
    assert.strictEqual(versions[1].version, '1.0.0');
    assert.strictEqual(versions[1].collectionName, 'tank');
    assert.deepStrictEqual(versions[1].collectionId, small._id);
    assert.deepStrictEqual(versions[1].object, { _id: String(small._id), size: 'large' });
    assert.ok(versions[1].timestamp instanceof Date);
  });

  test('should get a version', async () => {
    const Tank: Model<TankDocument> = mongoose.model<TankDocument>('tank', CompiledSchema);
    const small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    const version = await small.getVersion('1.0.0');

    assert.ok(version._id);
    assert.strictEqual(version.version, '1.0.0');
    assert.strictEqual(version.collectionName, 'tank');
    assert.deepStrictEqual(version.collectionId, small._id);
    assert.deepStrictEqual(version.object, { _id: String(small._id), size: 'large' });
    assert.ok(version.timestamp instanceof Date);
  });

  test('should compare two versions', async () => {
    const Tank: Model<TankDocument> = mongoose.model<TankDocument>('tank', CompiledSchema);
    const small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    const diff = await small.compareVersions('0.0.0', '1.0.0');

    assert.deepStrictEqual(diff.diff, { size: ['small', 'large'] });
    assert.deepStrictEqual(diff.left, { _id: String(small._id), size: 'small' });
    assert.deepStrictEqual(diff.right, { _id: String(small._id), size: 'large' });
  });

  test('should create history for sub documents', async () => {
    const parentSchema = new Schema<ParentDocument>({ tanks: [EmbeddedSchema] });
    const Parent: Model<ParentDocument> = mongoose.model<ParentDocument>('parent', parentSchema);

    const tanks = new Parent({ tanks: [{ size: 'small' }] });
    await tanks.save();
    tanks.tanks[0].size = 'large';
    await tanks.save();

    const tank = tanks.tanks[0];
    const diffs = await tank.getDiffs();

    assert.strictEqual(diffs.length, 2);

    assert.ok(diffs[0]._id);
    assert.strictEqual(diffs[0].version, '1.0.0');
    assert.strictEqual(diffs[0].collectionName, 'EmbeddedCollection');
    assert.deepStrictEqual(diffs[0].collectionId, tank._id);
    assert.deepStrictEqual(diffs[0].diff, { size: ['small', 'large'] });
    assert.ok(diffs[0].timestamp instanceof Date);

    assert.ok(diffs[1]._id);
    assert.strictEqual(diffs[1].version, '0.0.0');
    assert.strictEqual(diffs[1].collectionName, 'EmbeddedCollection');
    assert.deepStrictEqual(diffs[1].collectionId, tank._id);
    assert.deepStrictEqual(diffs[1].diff, { _id: [String(tank._id)], size: ['small'] });
    assert.ok(diffs[1].timestamp instanceof Date);
  });

  test('should have required indexes on history collection', async () => {
    const HistoryModel = mongoose.model('__histories');
    await HistoryModel.init();
    const indexes = await HistoryModel.collection.getIndexes();

    assert.ok(indexes['collectionName_1_collectionId_1_timestamp_-1']);
    assert.ok(indexes['collectionName_1_collectionId_1_version_1']);
  });

  test('should have required indexes on embedded history collection', async () => {
    const EmbeddedHistoryModel = mongoose.model('__embedded_histories');
    await EmbeddedHistoryModel.init();
    const indexes = await EmbeddedHistoryModel.collection.getIndexes();

    assert.ok(indexes['collectionName_1_collectionId_1_timestamp_-1']);
    assert.ok(indexes['collectionName_1_collectionId_1_version_1']);
  });
});
