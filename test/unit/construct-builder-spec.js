'use strict';

const _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
const _sinon = require('sinon');

const expect = _chai.expect;

const _path = require('path');
const { Promise } = require('bluebird');
const _rewire = require('rewire');

const {
    asyncHelper: _asyncHelper,
    ObjectMock,
    testValues: _testValues
} = require('@vamship/test-utils');

const MethodController = require('../utils/method-controller');

const ConstructBuilder = _rewire('../../src/construct-builder');
const ConstructFactory = require('../../src/construct-factory');
const DirInfo = require('../../src/dir-info');

describe('ConstructBuilder', () => {
    function _createInstance(rootPath) {
        rootPath = rootPath || _testValues.getString('rootPath');

        return new ConstructBuilder(rootPath);
    }

    function _createFactoryModules(count) {
        return new Array(count)
            .fill(0)
            .map((item, index) => {
                const factory = new ConstructFactory(`factory-${index}`);
                factory._init = () => ({});
                return factory;
            })
            .map((construct) => ({
                construct,
                directory: new DirInfo(_testValues.getString('name'), '')
            }));
    }

    let _fsMock;
    let _loadModuleStub;
    let _loadRecursiveCtrl = new MethodController(
        {
            READ_DIR: 0,
            END: 1
        },
        function* resolver(iteration) {
            const readdirMethod = _fsMock.mocks.readdir;

            const callback = readdirMethod.stub.args[iteration][2];
            yield callback(null, _fsMock.__dirData[iteration]);
        }
    );

    beforeEach(() => {
        _fsMock = new ObjectMock()
            .addMock('readdir')
            .addMock('readdirSync', () => {
                const data = _fsMock.__dirData[_fsMock.__callIndex];
                _fsMock.__callIndex++;

                return data;
            });
        _fsMock.__callIndex = 0;
        _fsMock.__dirData = [[]];

        ConstructBuilder.__set__('_fs', _fsMock.instance);

        _loadModuleStub = _sinon.stub();

        ConstructBuilder.__set__('_loadModule', _loadModuleStub);
    });

    describe('[static]', () => {
        function _createDirInfo(name, path) {
            name = name || _testValues.getString('name');
            path = path || _testValues.getString('path');

            return new DirInfo(name, path);
        }

        function _createDirList(dirs, files) {
            const dirList = [];

            dirs = dirs || [];
            files = files || [];

            dirs.reduce((result, item, index) => {
                result.push({
                    name: item,
                    isDirectory: () => true,
                    isFile: () => false
                });
                return dirList;
            }, dirList);

            files.reduce((result, item, index) => {
                result.push({
                    name: item,
                    isDirectory: () => false,
                    isFile: () => true
                });
                return dirList;
            }, dirList);

            return dirList;
        }

        function _buildFileList(callback, count) {
            if (typeof callback === 'string') {
                const extension = callback;
                callback = (item, index) => `item-${index}.${extension}`;
            } else if (typeof callback !== 'function') {
                callback = (item, index) => `item-${index}`;
            }

            count = typeof count !== 'number' ? 3 : count;
            return new Array(count).fill(0).map(callback);
        }

        it('should export the expected static methods', () => {
            expect(ConstructBuilder._loadRecursive).to.be.a('function');
            expect(ConstructBuilder._loadRecursiveSync).to.be.a('function');
        });

        describe('_loadRecursive()', () => {
            it('should reject the promise if invoked without a valid DirInfo object', async () => {
                const inputs = _testValues.allButObject({});
                const error = 'Invalid directory (arg #1)';

                return Promise.map(inputs, (directory) => {
                    const ret = ConstructBuilder._loadRecursive(directory);

                    return expect(ret).to.have.been.rejectedWith(error);
                });
            });

            it('should read the contents of the specified directory', async () => {
                const readdirMethod = _fsMock.mocks.readdir;
                const dir = _createDirInfo();

                expect(readdirMethod.stub).to.not.have.been.called;

                ConstructBuilder._loadRecursive(dir);

                await _loadRecursiveCtrl.resolveUntil(
                    _loadRecursiveCtrl.READ_DIR
                );

                expect(readdirMethod.stub).to.have.been.calledOnce;
                expect(readdirMethod.stub.args[0]).to.have.length(3);
                expect(readdirMethod.stub.args[0][0]).to.equal(dir.absPath);
                expect(readdirMethod.stub.args[0][1]).to.deep.equal({
                    withFileTypes: true
                });
            });

            it('should reject the promise if the directory read fails', async () => {
                const readdirMethod = _fsMock.mocks.readdir;
                const dir = _createDirInfo();
                const error = 'something went wrong!';

                expect(readdirMethod.stub).to.not.have.been.called;

                const ret = ConstructBuilder._loadRecursive(dir);
                await _loadRecursiveCtrl.resolveUntil(
                    _loadRecursiveCtrl.READ_DIR
                );

                const callback = readdirMethod.stub.args[0][2];
                callback(error);

                await expect(ret).to.be.rejectedWith(error);
            });

            it('should ignore any entity that is not a file or a directory', async () => {
                const readdirMethod = _fsMock.mocks.readdir;
                const dir = _createDirInfo();
                const fileList = _buildFileList('.js', 5);
                const dirList = _buildFileList(null, 5);

                _fsMock.__dirData[0] = _createDirList(dirList, fileList).map(
                    (item) => {
                        return Object.assign(item, {
                            isDirectory: () => false,
                            isFile: () => false
                        });
                    }
                );

                expect(readdirMethod.stub).to.not.have.been.called;
                expect(_loadModuleStub).to.not.have.been.called;

                ConstructBuilder._loadRecursive(dir);
                await _loadRecursiveCtrl.resolveUntil(_loadRecursiveCtrl.END);

                expect(readdirMethod.stub).to.have.been.calledOnce;
                expect(_loadModuleStub).to.not.have.been.called;
            });

            it('should ignore any entity that does not have a .js extension', async () => {
                const readdirMethod = _fsMock.mocks.readdir;
                const dir = _createDirInfo();
                const fileList = _buildFileList('java', 5);
                const dirList = [];

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);

                expect(readdirMethod.stub).to.not.have.been.called;
                expect(_loadModuleStub).to.not.have.been.called;

                ConstructBuilder._loadRecursive(dir);
                await _loadRecursiveCtrl.resolveUntil(_loadRecursiveCtrl.END);

                // No recursive calls to readdir because there are no child dirs
                expect(readdirMethod.stub).to.have.been.calledOnce;
                expect(_loadModuleStub).to.not.have.been.called;
            });

            it('should load (require) each entity that has a .js extension', async () => {
                const readdirMethod = _fsMock.mocks.readdir;
                const dir = _createDirInfo();
                const fileList = _buildFileList('js', 5);
                const dirList = [];

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);

                expect(readdirMethod.stub).to.not.have.been.called;
                expect(_loadModuleStub).to.not.have.been.called;

                ConstructBuilder._loadRecursive(dir);
                await _loadRecursiveCtrl
                    .resolveUntil(_loadRecursiveCtrl.END)
                    .then(_asyncHelper.wait(10));

                // No recursive calls to readdir because there are no child dirs
                expect(readdirMethod.stub).to.have.been.calledOnce;

                expect(_loadModuleStub).to.have.been.called;
                expect(_loadModuleStub.callCount).to.equal(fileList.length);

                fileList.forEach((file, index) => {
                    const modulePath = _path.resolve(dir.absPath, file);
                    expect(_loadModuleStub.args[index]).to.have.length(1);
                    expect(_loadModuleStub.args[index][0]).to.equal(modulePath);
                });
            });

            it('should reject the promise if any of the load operations fails', async () => {
                const dir = _createDirInfo();
                const fileList = _buildFileList('js', 5);
                const dirList = [];
                const error = new Error('something went wrong!');

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);
                _loadModuleStub.throws(error);

                const ret = ConstructBuilder._loadRecursive(dir);
                await _loadRecursiveCtrl.resolveUntil(_loadRecursiveCtrl.END);

                await expect(ret).to.be.rejectedWith(error);
            });

            it('should recursively load data from every directory in the list', async () => {
                const dir = _createDirInfo();
                const fileList = [];
                const dirList = _buildFileList(undefined, 5);

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);

                ConstructBuilder._loadRecursive(dir);
                const loadRecursiveStub = _sinon.stub(
                    ConstructBuilder,
                    '_loadRecursive'
                );

                try {
                    expect(loadRecursiveStub).to.not.have.been.called;

                    await _loadRecursiveCtrl.resolveUntil(
                        _loadRecursiveCtrl.END
                    );

                    expect(loadRecursiveStub).to.have.been.called;
                    expect(loadRecursiveStub.callCount).to.equal(
                        dirList.length
                    );

                    dirList.forEach((dirName, index) => {
                        const args = loadRecursiveStub.args[index];
                        const child = dir.createChild(dirName);

                        expect(args).to.have.length(1);
                        expect(args[0]).to.be.an.instanceof(DirInfo);
                        expect(args[0].absPath).to.equal(child.absPath);
                    });
                } finally {
                    loadRecursiveStub.restore();
                }
            });

            it('should reject the promise if the recursive load call fails', async () => {
                const dir = _createDirInfo();
                const fileList = [];
                const dirList = _buildFileList(undefined, 5);
                const error = new Error('something went wrong!');

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);

                const ret = ConstructBuilder._loadRecursive(dir);
                const loadRecursiveStub = _sinon.stub(
                    ConstructBuilder,
                    '_loadRecursive'
                );

                try {
                    loadRecursiveStub.throws(error);

                    await _loadRecursiveCtrl.resolveUntil(
                        _loadRecursiveCtrl.END
                    );
                    await expect(ret).to.be.rejectedWith(error);
                } finally {
                    loadRecursiveStub.restore();
                }
            });

            it('should return a list of initialized modules if the call succeeds', async () => {
                const dir = _createDirInfo();
                const dirTree = [
                    _createDirList(
                        ['child_1', 'child_2'],
                        [
                            'ignore-01.java',
                            'ignore-02.java',
                            'module-01.js',
                            'module-02.js'
                        ]
                    ),
                    _createDirList(
                        ['child_11'],
                        ['ignore-11.cs', 'module-11.js', 'module-12.js']
                    ),
                    _createDirList(
                        [],
                        ['ignore-21.rs', 'module-21.js', 'module-22.js']
                    ),
                    _createDirList(
                        [],
                        ['ignore-111.txt', 'module-111.js', 'module-112.js']
                    )
                ];
                _fsMock.__dirData = dirTree;

                const expectedConstructs = [];

                _loadModuleStub.callsFake((path) => {
                    const construct = new ConstructFactory(path);
                    expectedConstructs.push(construct);
                    return construct;
                });

                const ret = ConstructBuilder._loadRecursive(dir);

                await Promise.mapSeries(dirTree, async (item, iteration) => {
                    await _loadRecursiveCtrl.resolveUntil(
                        _loadRecursiveCtrl.END,
                        iteration
                    );
                    await _asyncHelper.wait(10)();
                });

                const modules = await expect(ret).to.have.been.fulfilled;
                expect(modules).to.have.length(expectedConstructs.length);

                modules.forEach((module, index) => {
                    expect(module).to.be.an('object');
                    expect(module.construct).to.be.an.instanceof(
                        ConstructFactory
                    );
                    expect(expectedConstructs).to.deep.include(
                        module.construct
                    );

                    expect(module.directory).to.be.an.instanceof(DirInfo);
                });
            });
        });

        describe('_loadRecursiveSync()', () => {
            it('should throw an error if invoked without a valid DirInfo object', () => {
                const inputs = _testValues.allButObject({});
                const error = 'Invalid directory (arg #1)';

                inputs.forEach((directory) => {
                    const wrapper = () =>
                        ConstructBuilder._loadRecursiveSync(directory);

                    return expect(wrapper).to.throw(error);
                });
            });

            it('should read the contents of the specified directory', () => {
                const readdirSyncMethod = _fsMock.mocks.readdirSync;
                const dir = _createDirInfo();

                expect(readdirSyncMethod.stub).to.not.have.been.called;

                ConstructBuilder._loadRecursiveSync(dir);

                expect(readdirSyncMethod.stub).to.have.been.calledOnce;
                expect(readdirSyncMethod.stub.args[0]).to.have.length(2);
                expect(readdirSyncMethod.stub.args[0][0]).to.equal(dir.absPath);
                expect(readdirSyncMethod.stub.args[0][1]).to.deep.equal({
                    withFileTypes: true
                });
            });

            it('should ignore any entity that is not a file or a directory', () => {
                const readdirSyncMethod = _fsMock.mocks.readdirSync;
                const dir = _createDirInfo();
                const fileList = _buildFileList('.js', 5);
                const dirList = _buildFileList(null, 5);

                _fsMock.__dirData[0] = _createDirList(dirList, fileList).map(
                    (item) => {
                        return Object.assign(item, {
                            isDirectory: () => false,
                            isFile: () => false
                        });
                    }
                );

                expect(readdirSyncMethod.stub).to.not.have.been.called;
                expect(_loadModuleStub).to.not.have.been.called;

                ConstructBuilder._loadRecursiveSync(dir);

                expect(readdirSyncMethod.stub).to.have.been.calledOnce;
                expect(_loadModuleStub).to.not.have.been.called;
            });

            it('should ignore any entity that does not have a .js extension', () => {
                const readdirSyncMethod = _fsMock.mocks.readdirSync;
                const dir = _createDirInfo();
                const fileList = _buildFileList('java', 5);
                const dirList = [];

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);

                expect(readdirSyncMethod.stub).to.not.have.been.called;
                expect(_loadModuleStub).to.not.have.been.called;

                ConstructBuilder._loadRecursiveSync(dir);

                // No recursive calls to readdirSync because there are no child dirs
                expect(readdirSyncMethod.stub).to.have.been.calledOnce;
                expect(_loadModuleStub).to.not.have.been.called;
            });

            it('should load (require) each entity that has a .js extension', () => {
                const readdirSyncMethod = _fsMock.mocks.readdirSync;
                const dir = _createDirInfo();
                const fileList = _buildFileList('js', 5);
                const dirList = [];

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);

                expect(readdirSyncMethod.stub).to.not.have.been.called;
                expect(_loadModuleStub).to.not.have.been.called;

                ConstructBuilder._loadRecursiveSync(dir);

                // No recursive calls to readdirSync because there are no child dirs
                expect(readdirSyncMethod.stub).to.have.been.calledOnce;

                expect(_loadModuleStub).to.have.been.called;
                expect(_loadModuleStub.callCount).to.equal(fileList.length);

                fileList.forEach((file, index) => {
                    const modulePath = _path.resolve(dir.absPath, file);
                    expect(_loadModuleStub.args[index]).to.have.length(1);
                    expect(_loadModuleStub.args[index][0]).to.equal(modulePath);
                });
            });

            it('should recursively load data from every directory in the list', () => {
                const dir = _createDirInfo();
                const fileList = [];
                const dirList = _buildFileList(undefined, 5);

                _fsMock.__dirData[0] = _createDirList(dirList, fileList);

                const loadRecursiveSyncStub = _sinon.stub(
                    ConstructBuilder,
                    '_loadRecursiveSync'
                );

                try {
                    loadRecursiveSyncStub.callThrough();
                    dirList.forEach((item, index) => {
                        loadRecursiveSyncStub.onCall(index + 1).returns(0);
                    });

                    ConstructBuilder._loadRecursiveSync(dir);

                    expect(loadRecursiveSyncStub).to.have.been.called;
                    expect(loadRecursiveSyncStub.callCount).to.equal(
                        dirList.length + 1
                    );

                    dirList.forEach((dirName, index) => {
                        const args = loadRecursiveSyncStub.args[index + 1];
                        const child = dir.createChild(dirName);

                        expect(args).to.have.length(1);
                        expect(args[0]).to.be.an.instanceof(DirInfo);
                        expect(args[0].absPath).to.equal(child.absPath);
                    });
                } finally {
                    loadRecursiveSyncStub.restore();
                }
            });

            it('should return a list of initialized modules if the call succeeds', () => {
                const dir = _createDirInfo();
                const dirTree = [
                    _createDirList(
                        ['child_1', 'child_2'],
                        [
                            'ignore-01.java',
                            'ignore-02.java',
                            'module-01.js',
                            'module-02.js'
                        ]
                    ),
                    _createDirList(
                        ['child_11'],
                        ['ignore-11.cs', 'module-11.js', 'module-12.js']
                    ),
                    _createDirList(
                        [],
                        ['ignore-21.rs', 'module-21.js', 'module-22.js']
                    ),
                    _createDirList(
                        [],
                        ['ignore-111.txt', 'module-111.js', 'module-112.js']
                    )
                ];
                _fsMock.__dirData = dirTree;

                const expectedConstructs = [];

                _loadModuleStub.callsFake((path) => {
                    const construct = new ConstructFactory(path);
                    expectedConstructs.push(construct);
                    return construct;
                });

                const modules = ConstructBuilder._loadRecursiveSync(dir);

                expect(modules).to.have.length(expectedConstructs.length);

                modules.forEach((module, index) => {
                    expect(module).to.be.an('object');
                    expect(module.construct).to.be.an.instanceof(
                        ConstructFactory
                    );
                    expect(expectedConstructs).to.deep.include(
                        module.construct
                    );

                    expect(module.directory).to.be.an.instanceof(DirInfo);
                });
            });
        });
    });

    describe('ctor()', () => {
        it('should throw an error if invoked without a valid rootPath', () => {
            const inputs = _testValues.allButString('');
            const error = 'Invalid rootPath (arg #1)';

            inputs.forEach((rootPath) => {
                const wrapper = () => new ConstructBuilder(rootPath);

                expect(wrapper).to.throw(error);
            });
        });

        it('should return an object with the expected methods and properties', () => {
            const rootPath = _testValues.getString('rootPath');
            const builder = new ConstructBuilder(rootPath);

            expect(builder).to.be.an('object');
            expect(builder.prefetchConstructs).to.be.a('function');
            expect(builder.build).to.be.a('function');
        });
    });

    describe('prefetchConstructs()', () => {
        let _loadRecursiveStub;
        let _factoryModules;

        beforeEach(() => {
            _factoryModules = [];
            _loadRecursiveStub = _sinon
                .stub(ConstructBuilder, '_loadRecursive')
                .callsFake(() => _factoryModules);
        });

        afterEach(() => {
            _loadRecursiveStub.restore();
        });

        it('should recursively load moadules defined under the rootPath', () => {
            const rootPath = _testValues.getString('rootPath');
            const builder = new ConstructBuilder(rootPath);

            expect(_loadRecursiveStub).to.not.have.been.called;

            builder.prefetchConstructs();

            expect(_loadRecursiveStub).to.have.been.calledOnce;
            expect(_loadRecursiveStub.args[0][0]).to.be.an.instanceof(DirInfo);
            expect(_loadRecursiveStub.args[0][0].path).to.equal(rootPath);
        });

        it('should reject the promise if the recursive load fails', async () => {
            const rootPath = _testValues.getString('rootPath');
            const builder = new ConstructBuilder(rootPath);
            const error = new Error('something went wrong!');

            _loadRecursiveStub.throws(error);

            const ret = builder.prefetchConstructs();

            await expect(ret).to.have.been.rejectedWith(error);
        });

        it('should resolve the promise if the recursive load succeeds', async () => {
            const rootPath = _testValues.getString('rootPath');
            const builder = new ConstructBuilder(rootPath);
            const expectedFactories = _createFactoryModules(10);

            _factoryModules = expectedFactories;

            const ret = builder.prefetchConstructs();

            await expect(ret).to.have.been.fulfilled;
            expect(builder._factoryModules).to.deep.equal(expectedFactories);
        });

        it('should filter out any modules that are not construct factories', async () => {
            const rootPath = _testValues.getString('rootPath');
            const builder = new ConstructBuilder(rootPath);
            const expectedFactories = _createFactoryModules(10);

            _factoryModules = expectedFactories.concat(
                new Array(10).fill(0).map((item, index) => ({
                    construct: {
                        initialize: _sinon.spy(),
                        configure: _sinon.spy(),
                        getInstance: _sinon.spy()
                    },
                    directory: new DirInfo(_testValues.getString('name'), '')
                }))
            );

            const ret = builder.prefetchConstructs();

            await expect(ret).to.have.been.fulfilled;
            expect(builder._factoryModules).to.deep.equal(expectedFactories);
        });
    });

    describe('build()', () => {
        let _loadRecursiveSyncStub;
        let _factoryModules;

        beforeEach(() => {
            _factoryModules = [];
            _loadRecursiveSyncStub = _sinon
                .stub(ConstructBuilder, '_loadRecursiveSync')
                .callsFake(() => _factoryModules);
        });

        afterEach(() => {
            _loadRecursiveSyncStub.restore();
        });

        function _createScope(stackName) {
            stackName = stackName || _testValues.getString('stackName');

            return { stackName };
        }

        it('should throw an error if invoked without a valid scope', () => {
            const inputs = _testValues.allButObject();
            const error = 'Invalid scope (arg #1)';

            inputs.forEach((scope) => {
                const builder = _createInstance();
                const wrapper = () => builder.build(scope);

                expect(wrapper).to.throw(error);
            });
        });

        it('should invoke the synchronous load method if factory modules have not yet been loaded', () => {
            const rootPath = _testValues.getString('rootPath');
            const builder = new ConstructBuilder(rootPath);
            const scope = _createScope();
            const expectedFactories = _createFactoryModules(10);

            _factoryModules = expectedFactories;

            expect(_loadRecursiveSyncStub).to.not.have.been.called;

            builder.build(scope);

            expect(_loadRecursiveSyncStub).to.have.been.calledOnce;

            expect(_loadRecursiveSyncStub).to.have.been.calledOnce;
            expect(_loadRecursiveSyncStub.args[0][0]).to.be.an.instanceof(DirInfo);
            expect(_loadRecursiveSyncStub.args[0][0].path).to.equal(rootPath);

            expect(builder._factoryModules).to.deep.equal(expectedFactories);
        });

        it('should not invoke the synchronous load method if factory modules have already been loaded', () => {
            const rootPath = _testValues.getString('rootPath');
            const builder = new ConstructBuilder(rootPath);
            const scope = _createScope();

            builder._factoryModules = _factoryModules;

            expect(_loadRecursiveSyncStub).to.not.have.been.called;

            builder.build(scope);

            expect(_loadRecursiveSyncStub).to.not.have.been.called;
        });

        it('should initialize and configure all loaded construct factories with default props', () => {
            const builder = _createInstance();
            const scope = _createScope();
            const factoryModules = _createFactoryModules(10);

            builder._factoryModules = factoryModules;
            const stubs = builder._factoryModules.map(
                ({ construct, directory }) => ({
                    init: _sinon.stub(construct, 'init'),
                    configure: _sinon.stub(construct, 'configure'),
                    directory
                })
            );

            builder.build(scope);

            stubs.forEach((stubs, index) => {
                const { init, configure, directory } = stubs;

                expect(init).to.have.been.calledOnce;
                expect(init.args[0]).to.have.length(3);
                expect(init.args[0][0]).to.equal(scope);
                expect(init.args[0][1]).to.equal(directory);
                expect(init.args[0][2]).to.deep.equal({});

                expect(configure).to.have.been.calledOnce;
                expect(configure.args[0]).to.have.length(3);
                expect(configure.args[0][0]).to.equal(scope);
                expect(configure.args[0][1]).to.equal(directory);
                expect(configure.args[0][2]).to.deep.equal({});
            });
        });

        it('should initialize and configure all loaded construct factories with specified props', () => {
            const builder = _createInstance();
            const scope = _createScope();
            const factoryModules = _createFactoryModules(10);

            builder._factoryModules = factoryModules;
            const stubs = builder._factoryModules.map(
                ({ construct, directory }) => ({
                    init: _sinon.stub(construct, 'init'),
                    configure: _sinon.stub(construct, 'configure'),
                    directory
                })
            );

            const props = {
                foo: _testValues.getString('foo')
            };
            builder.build(scope, props);

            stubs.forEach((stubs, index) => {
                const { init, configure, directory } = stubs;

                expect(init).to.have.been.calledOnce;
                expect(init.args[0]).to.have.length(3);
                expect(init.args[0][0]).to.equal(scope);
                expect(init.args[0][1]).to.equal(directory);
                expect(init.args[0][2]).to.deep.equal(props);

                expect(configure).to.have.been.calledOnce;
                expect(configure.args[0]).to.have.length(3);
                expect(configure.args[0][0]).to.equal(scope);
                expect(configure.args[0][1]).to.equal(directory);
                expect(configure.args[0][2]).to.deep.equal(props);
            });
        });
    });
});
