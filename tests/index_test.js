import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import DbHelper from './helpers/db.js';

const { start, close, MongooseHistoryPlugin } = DbHelper(mongoose);

// Default options
const options = {
  userCollection: 'users', // Colletcion to ref when you pass an user id
  accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
  userFieldName: 'user', // Name of the property for the user
  accountFieldName: 'account', // Name of the property of the account if any
  timestampFieldName: 'timestamp', // Name of the property of the timestamp
  methodFieldName: 'method', // Name of the property of the method
  ignore: [], // List of fields to ignore when compare changes
  noDiffSave: false, // If true save event even if there are no changes
  noDiffSaveOnMethods: ['delete'], // If a method is in this list, it saves history even if there is no diff.
  noEventSave: true, // If false save only when __history property is passed
  modelName: '__histories', // Name of the collection for the histories
  mongoose: mongoose // A mongoose instance
};

const HistoryPlugin = MongooseHistoryPlugin(options);

const CompiledSchema = mongoose.Schema({ name: 'string', size: 'string' });
CompiledSchema.plugin(HistoryPlugin);

const embeddedOptionDefaults = {embeddedDocument: true, embeddedModelName: 'EmbeddedCollection', modelName: '__embedded_histories'};
const embeddedOptions = Object.assign({}, options, embeddedOptionDefaults);
const EmbeddedSchema = mongoose.Schema({ name: 'string', size: 'string' });
EmbeddedSchema.plugin(MongooseHistoryPlugin(embeddedOptions));

describe('Mongoose History Plugin', () => {
  before(async () => {
    await start({ log: console.log });
  });

  after(async () => {
    await close();
  });

  test('should add the plugin to a schema', async () => {
    // Create a new schema
    let Schema = mongoose.Schema({ name: 'string', size: 'string' });

    // Initial schema must have no plugins
    assert.deepStrictEqual(Schema.plugins, []);

    // Add the mongoose history plguin
    Schema.plugin(HistoryPlugin);

    // Expect the plugin to be added to the schema
    assert.strictEqual(Schema.plugins.length, 1);
    assert.strictEqual(typeof Schema.plugins[0].fn, 'function');
  });

  test('should test methods added to the schema', async () => {
    let Schema = mongoose.Schema({ name: 'string', size: 'string' });
    Schema.plugin(HistoryPlugin);

    assert.strictEqual(typeof Schema.methods.getDiffs, 'function');
    assert.strictEqual(typeof Schema.methods.getDiff, 'function');
    assert.strictEqual(typeof Schema.methods.getVersion, 'function');
    assert.strictEqual(typeof Schema.methods.getVersions, 'function');
    assert.strictEqual(typeof Schema.methods.compareVersions, 'function');
  });

  test('should test methods added to the model', async () => {
    let Tank = mongoose.model('tank', CompiledSchema);
    let small = new Tank({
      size: 'small'
    });

    assert.strictEqual(typeof small.getDiffs, 'function');
    assert.strictEqual(typeof small.getDiff, 'function');
    assert.strictEqual(typeof small.getVersion, 'function');
    assert.strictEqual(typeof small.getVersions, 'function');
    assert.strictEqual(typeof small.compareVersions, 'function');
  });

  test('should create history when save', async () => {
    let Tank = mongoose.model('tank', CompiledSchema);
    let small = new Tank({
      size: 'small'
    });

    await small.save();
    let diffs = await small.getDiffs();

    assert.strictEqual(diffs.length, 1);
    assert.ok(diffs[0]._id);
    assert.strictEqual(diffs[0].version, '0.0.0');
    assert.strictEqual(diffs[0].collectionName, 'tank');
    assert.deepStrictEqual(diffs[0].collectionId, small._id);
    assert.deepStrictEqual(diffs[0].diff, { _id: [String(small._id)], size: ['small'] });
    assert.ok(diffs[0].timestamp instanceof Date);
  });

  test('should create history when save a change', async () => {
    let Tank = mongoose.model('tank', CompiledSchema);
    let small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    let diffs = await small.getDiffs();

    assert.strictEqual(diffs.length, 2);

    // First diff (most recent)
    assert.ok(diffs[0]._id);
    assert.strictEqual(diffs[0].version, '1.0.0');
    assert.strictEqual(diffs[0].collectionName, 'tank');
    assert.deepStrictEqual(diffs[0].collectionId, small._id);
    assert.deepStrictEqual(diffs[0].diff, { size: ['small', 'large'] });
    assert.ok(diffs[0].timestamp instanceof Date);

    // Second diff (initial)
    assert.ok(diffs[1]._id);
    assert.strictEqual(diffs[1].version, '0.0.0');
    assert.strictEqual(diffs[1].collectionName, 'tank');
    assert.deepStrictEqual(diffs[1].collectionId, small._id);
    assert.deepStrictEqual(diffs[1].diff, { _id: [String(small._id)], size: ['small'] });
    assert.ok(diffs[1].timestamp instanceof Date);
  });

  test('should get a diff by version', async () => {
    let Tank = mongoose.model('tank', CompiledSchema);
    let small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    let diffs = await small.getDiff('1.0.0');

    assert.ok(diffs._id);
    assert.strictEqual(diffs.version, '1.0.0');
    assert.strictEqual(diffs.collectionName, 'tank');
    assert.deepStrictEqual(diffs.collectionId, small._id);
    assert.deepStrictEqual(diffs.diff, { size: ['small', 'large'] });
    assert.ok(diffs.timestamp instanceof Date);
  });

  test('should get all versions', async () => {
    let Tank = mongoose.model('tank', CompiledSchema);
    let small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    let versions = await small.getVersions();

    assert.strictEqual(versions.length, 2);

    // First version
    assert.ok(versions[0]._id);
    assert.strictEqual(versions[0].version, '0.0.0');
    assert.strictEqual(versions[0].collectionName, 'tank');
    assert.deepStrictEqual(versions[0].collectionId, small._id);
    assert.deepStrictEqual(versions[0].object, { _id: String(small._id), size: 'small' });
    assert.ok(versions[0].timestamp instanceof Date);

    // Second version
    assert.ok(versions[1]._id);
    assert.strictEqual(versions[1].version, '1.0.0');
    assert.strictEqual(versions[1].collectionName, 'tank');
    assert.deepStrictEqual(versions[1].collectionId, small._id);
    assert.deepStrictEqual(versions[1].object, { _id: String(small._id), size: 'large' });
    assert.ok(versions[1].timestamp instanceof Date);
  });

  test('should get a version', async () => {
    let Tank = mongoose.model('tank', CompiledSchema);
    let small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    let version = await small.getVersion('1.0.0');

    assert.ok(version._id);
    assert.strictEqual(version.version, '1.0.0');
    assert.strictEqual(version.collectionName, 'tank');
    assert.deepStrictEqual(version.collectionId, small._id);
    assert.deepStrictEqual(version.object, { _id: String(small._id), size: 'large' });
    assert.ok(version.timestamp instanceof Date);
  });

  test('should compare two versions', async () => {
    let Tank = mongoose.model('tank', CompiledSchema);
    let small = new Tank({
      size: 'small'
    });

    await small.save();
    small.size = 'large';
    await small.save();
    let diff = await small.compareVersions('0.0.0', '1.0.0');

    assert.deepStrictEqual(diff.diff, { size: ['small', 'large'] });
    assert.deepStrictEqual(diff.left, { _id: String(small._id), size: 'small' });
    assert.deepStrictEqual(diff.right, { _id: String(small._id), size: 'large' });
  });

  test('should create history for sub documents', async () => {
    let parentSchema = mongoose.Schema({tanks: [EmbeddedSchema]});
    let Parent = mongoose.model('parent', parentSchema);

    let tanks = new Parent({tanks: [{size: 'small'}]});
    await tanks.save();
    tanks.tanks[0].size = 'large';
    await tanks.save();

    let tank = tanks.tanks[0];
    let diffs = await tank.getDiffs();

    assert.strictEqual(diffs.length, 2);

    // First diff (most recent)
    assert.ok(diffs[0]._id);
    assert.strictEqual(diffs[0].version, '1.0.0');
    assert.strictEqual(diffs[0].collectionName, 'EmbeddedCollection');
    assert.deepStrictEqual(diffs[0].collectionId, tank._id);
    assert.deepStrictEqual(diffs[0].diff, { size: ['small', 'large'] });
    assert.ok(diffs[0].timestamp instanceof Date);

    // Second diff (initial)
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
