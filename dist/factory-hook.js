#!/usr/bin/env node
import { createRequire as __factoryCreateRequire } from 'node:module';
const require = __factoryCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "node_modules/graceful-fs/polyfills.js"(exports, module) {
    var constants = __require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module.exports = patch;
    function patch(fs) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs);
      }
      if (!fs.lutimes) {
        patchLutimes(fs);
      }
      fs.chown = chownFix(fs.chown);
      fs.fchown = chownFix(fs.fchown);
      fs.lchown = chownFix(fs.lchown);
      fs.chmod = chmodFix(fs.chmod);
      fs.fchmod = chmodFix(fs.fchmod);
      fs.lchmod = chmodFix(fs.lchmod);
      fs.chownSync = chownFixSync(fs.chownSync);
      fs.fchownSync = chownFixSync(fs.fchownSync);
      fs.lchownSync = chownFixSync(fs.lchownSync);
      fs.chmodSync = chmodFixSync(fs.chmodSync);
      fs.fchmodSync = chmodFixSync(fs.fchmodSync);
      fs.lchmodSync = chmodFixSync(fs.lchmodSync);
      fs.stat = statFix(fs.stat);
      fs.fstat = statFix(fs.fstat);
      fs.lstat = statFix(fs.lstat);
      fs.statSync = statFixSync(fs.statSync);
      fs.fstatSync = statFixSync(fs.fstatSync);
      fs.lstatSync = statFixSync(fs.lstatSync);
      if (fs.chmod && !fs.lchmod) {
        fs.lchmod = function(path, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : (function(fs$rename) {
          function rename3(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename3, fs$rename);
          return rename3;
        })(fs.rename);
      }
      fs.read = typeof fs.read !== "function" ? fs.read : (function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      })(fs.read);
      fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : /* @__PURE__ */ (function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      })(fs.readSync);
      function patchLchmod(fs2) {
        fs2.lchmod = function(path, mode, callback) {
          fs2.open(
            path,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback) callback(err);
                return;
              }
              fs2.fchmod(fd, mode, function(err2) {
                fs2.close(fd, function(err22) {
                  if (callback) callback(err2 || err22);
                });
              });
            }
          );
        };
        fs2.lchmodSync = function(path, mode) {
          var fd = fs2.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs2.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs2) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
          fs2.lutimes = function(path, at2, mt, cb) {
            fs2.open(path, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs2.futimes(fd, at2, mt, function(er2) {
                fs2.close(fd, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs2.lutimesSync = function(path, at2, mt) {
            var fd = fs2.openSync(path, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs2.futimesSync(fd, at2, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs2.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs2.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs2.futimes) {
          fs2.lutimes = function(_a, _b, _c, cb) {
            if (cb) process.nextTick(cb);
          };
          fs2.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target, mode, cb) {
          return orig.call(fs, target, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target, mode) {
          try {
            return orig.call(fs, target, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs, target, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "node_modules/graceful-fs/legacy-streams.js"(exports, module) {
    var Stream = __require("stream").Stream;
    module.exports = legacy;
    function legacy(fs) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path, options);
        Stream.call(this);
        var self = this;
        this.path = path;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path, options);
        Stream.call(this);
        this.path = path;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "node_modules/graceful-fs/clone.js"(exports, module) {
    "use strict";
    module.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "node_modules/graceful-fs/graceful-fs.js"(exports, module) {
    var fs = __require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util2 = __require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = Symbol.for("graceful-fs.queue");
      previousSymbol = Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug = noop;
    if (util2.debuglog)
      debug = util2.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m = util2.format.apply(util2, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs, queue);
      fs.close = (function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      })(fs.close);
      fs.closeSync = (function(fs$closeSync) {
        function closeSync(fd) {
          fs$closeSync.apply(fs, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      })(fs.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs[gracefulQueue]);
          __require("assert").equal(fs[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs[gracefulQueue]);
    }
    module.exports = patch(clone(fs));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
      module.exports = patch(fs);
      fs.__patched = true;
    }
    function patch(fs2) {
      polyfills(fs2);
      fs2.gracefulify = patch;
      fs2.createReadStream = createReadStream;
      fs2.createWriteStream = createWriteStream;
      var fs$readFile = fs2.readFile;
      fs2.readFile = readFile2;
      function readFile2(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path, options, cb);
        function go$readFile(path2, options2, cb2, startTime) {
          return fs$readFile(path2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile;
      function writeFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path, data, options, cb);
        function go$writeFile(path2, data2, options2, cb2, startTime) {
          return fs$writeFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile;
      function appendFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path, data, options, cb);
        function go$appendFile(path2, data2, options2, cb2, startTime) {
          return fs$appendFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs2.readdir;
      fs2.readdir = readdir2;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir2(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, options2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path, options, cb);
        function fs$readdirCallback(path2, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path2, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs2);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs2.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs2.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs2, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs2, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs2, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs2, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open2(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open2(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream(path, options) {
        return new fs2.ReadStream(path, options);
      }
      function createWriteStream(path, options) {
        return new fs2.WriteStream(path, options);
      }
      var fs$open = fs2.open;
      fs2.open = open2;
      function open2(path, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path, flags, mode, cb);
        function go$open(path2, flags2, mode2, cb2, startTime) {
          return fs$open(path2, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path2, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs2;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs[gracefulQueue].length; ++i) {
        if (fs[gracefulQueue][i].length > 2) {
          fs[gracefulQueue][i][3] = now;
          fs[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs[gracefulQueue].length === 0)
        return;
      var elem = fs[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// node_modules/retry/lib/retry_operation.js
var require_retry_operation = __commonJS({
  "node_modules/retry/lib/retry_operation.js"(exports, module) {
    function RetryOperation(timeouts, options) {
      if (typeof options === "boolean") {
        options = { forever: options };
      }
      this._originalTimeouts = JSON.parse(JSON.stringify(timeouts));
      this._timeouts = timeouts;
      this._options = options || {};
      this._maxRetryTime = options && options.maxRetryTime || Infinity;
      this._fn = null;
      this._errors = [];
      this._attempts = 1;
      this._operationTimeout = null;
      this._operationTimeoutCb = null;
      this._timeout = null;
      this._operationStart = null;
      if (this._options.forever) {
        this._cachedTimeouts = this._timeouts.slice(0);
      }
    }
    module.exports = RetryOperation;
    RetryOperation.prototype.reset = function() {
      this._attempts = 1;
      this._timeouts = this._originalTimeouts;
    };
    RetryOperation.prototype.stop = function() {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this._timeouts = [];
      this._cachedTimeouts = null;
    };
    RetryOperation.prototype.retry = function(err) {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      if (!err) {
        return false;
      }
      var currentTime = (/* @__PURE__ */ new Date()).getTime();
      if (err && currentTime - this._operationStart >= this._maxRetryTime) {
        this._errors.unshift(new Error("RetryOperation timeout occurred"));
        return false;
      }
      this._errors.push(err);
      var timeout = this._timeouts.shift();
      if (timeout === void 0) {
        if (this._cachedTimeouts) {
          this._errors.splice(this._errors.length - 1, this._errors.length);
          this._timeouts = this._cachedTimeouts.slice(0);
          timeout = this._timeouts.shift();
        } else {
          return false;
        }
      }
      var self = this;
      var timer = setTimeout(function() {
        self._attempts++;
        if (self._operationTimeoutCb) {
          self._timeout = setTimeout(function() {
            self._operationTimeoutCb(self._attempts);
          }, self._operationTimeout);
          if (self._options.unref) {
            self._timeout.unref();
          }
        }
        self._fn(self._attempts);
      }, timeout);
      if (this._options.unref) {
        timer.unref();
      }
      return true;
    };
    RetryOperation.prototype.attempt = function(fn, timeoutOps) {
      this._fn = fn;
      if (timeoutOps) {
        if (timeoutOps.timeout) {
          this._operationTimeout = timeoutOps.timeout;
        }
        if (timeoutOps.cb) {
          this._operationTimeoutCb = timeoutOps.cb;
        }
      }
      var self = this;
      if (this._operationTimeoutCb) {
        this._timeout = setTimeout(function() {
          self._operationTimeoutCb();
        }, self._operationTimeout);
      }
      this._operationStart = (/* @__PURE__ */ new Date()).getTime();
      this._fn(this._attempts);
    };
    RetryOperation.prototype.try = function(fn) {
      console.log("Using RetryOperation.try() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = function(fn) {
      console.log("Using RetryOperation.start() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = RetryOperation.prototype.try;
    RetryOperation.prototype.errors = function() {
      return this._errors;
    };
    RetryOperation.prototype.attempts = function() {
      return this._attempts;
    };
    RetryOperation.prototype.mainError = function() {
      if (this._errors.length === 0) {
        return null;
      }
      var counts = {};
      var mainError = null;
      var mainErrorCount = 0;
      for (var i = 0; i < this._errors.length; i++) {
        var error = this._errors[i];
        var message = error.message;
        var count = (counts[message] || 0) + 1;
        counts[message] = count;
        if (count >= mainErrorCount) {
          mainError = error;
          mainErrorCount = count;
        }
      }
      return mainError;
    };
  }
});

// node_modules/retry/lib/retry.js
var require_retry = __commonJS({
  "node_modules/retry/lib/retry.js"(exports) {
    var RetryOperation = require_retry_operation();
    exports.operation = function(options) {
      var timeouts = exports.timeouts(options);
      return new RetryOperation(timeouts, {
        forever: options && options.forever,
        unref: options && options.unref,
        maxRetryTime: options && options.maxRetryTime
      });
    };
    exports.timeouts = function(options) {
      if (options instanceof Array) {
        return [].concat(options);
      }
      var opts = {
        retries: 10,
        factor: 2,
        minTimeout: 1 * 1e3,
        maxTimeout: Infinity,
        randomize: false
      };
      for (var key in options) {
        opts[key] = options[key];
      }
      if (opts.minTimeout > opts.maxTimeout) {
        throw new Error("minTimeout is greater than maxTimeout");
      }
      var timeouts = [];
      for (var i = 0; i < opts.retries; i++) {
        timeouts.push(this.createTimeout(i, opts));
      }
      if (options && options.forever && !timeouts.length) {
        timeouts.push(this.createTimeout(i, opts));
      }
      timeouts.sort(function(a, b) {
        return a - b;
      });
      return timeouts;
    };
    exports.createTimeout = function(attempt, opts) {
      var random = opts.randomize ? Math.random() + 1 : 1;
      var timeout = Math.round(random * opts.minTimeout * Math.pow(opts.factor, attempt));
      timeout = Math.min(timeout, opts.maxTimeout);
      return timeout;
    };
    exports.wrap = function(obj, options, methods) {
      if (options instanceof Array) {
        methods = options;
        options = null;
      }
      if (!methods) {
        methods = [];
        for (var key in obj) {
          if (typeof obj[key] === "function") {
            methods.push(key);
          }
        }
      }
      for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        var original = obj[method];
        obj[method] = function retryWrapper(original2) {
          var op = exports.operation(options);
          var args = Array.prototype.slice.call(arguments, 1);
          var callback = args.pop();
          args.push(function(err) {
            if (op.retry(err)) {
              return;
            }
            if (err) {
              arguments[0] = op.mainError();
            }
            callback.apply(this, arguments);
          });
          op.attempt(function() {
            original2.apply(obj, args);
          });
        }.bind(obj, original);
        obj[method].options = options;
      }
    };
  }
});

// node_modules/retry/index.js
var require_retry2 = __commonJS({
  "node_modules/retry/index.js"(exports, module) {
    module.exports = require_retry();
  }
});

// node_modules/signal-exit/signals.js
var require_signals = __commonJS({
  "node_modules/signal-exit/signals.js"(exports, module) {
    module.exports = [
      "SIGABRT",
      "SIGALRM",
      "SIGHUP",
      "SIGINT",
      "SIGTERM"
    ];
    if (process.platform !== "win32") {
      module.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      module.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  }
});

// node_modules/signal-exit/index.js
var require_signal_exit = __commonJS({
  "node_modules/signal-exit/index.js"(exports, module) {
    var process2 = global.process;
    var processOk = function(process3) {
      return process3 && typeof process3 === "object" && typeof process3.removeListener === "function" && typeof process3.emit === "function" && typeof process3.reallyExit === "function" && typeof process3.listeners === "function" && typeof process3.kill === "function" && typeof process3.pid === "number" && typeof process3.on === "function";
    };
    if (!processOk(process2)) {
      module.exports = function() {
        return function() {
        };
      };
    } else {
      assert = __require("assert");
      signals = require_signals();
      isWin = /^win/i.test(process2.platform);
      EE = __require("events");
      if (typeof EE !== "function") {
        EE = EE.EventEmitter;
      }
      if (process2.__signal_exit_emitter__) {
        emitter = process2.__signal_exit_emitter__;
      } else {
        emitter = process2.__signal_exit_emitter__ = new EE();
        emitter.count = 0;
        emitter.emitted = {};
      }
      if (!emitter.infinite) {
        emitter.setMaxListeners(Infinity);
        emitter.infinite = true;
      }
      module.exports = function(cb, opts) {
        if (!processOk(global.process)) {
          return function() {
          };
        }
        assert.equal(typeof cb, "function", "a callback must be provided for exit handler");
        if (loaded === false) {
          load();
        }
        var ev = "exit";
        if (opts && opts.alwaysLast) {
          ev = "afterexit";
        }
        var remove = function() {
          emitter.removeListener(ev, cb);
          if (emitter.listeners("exit").length === 0 && emitter.listeners("afterexit").length === 0) {
            unload();
          }
        };
        emitter.on(ev, cb);
        return remove;
      };
      unload = function unload2() {
        if (!loaded || !processOk(global.process)) {
          return;
        }
        loaded = false;
        signals.forEach(function(sig) {
          try {
            process2.removeListener(sig, sigListeners[sig]);
          } catch (er) {
          }
        });
        process2.emit = originalProcessEmit;
        process2.reallyExit = originalProcessReallyExit;
        emitter.count -= 1;
      };
      module.exports.unload = unload;
      emit2 = function emit3(event, code, signal) {
        if (emitter.emitted[event]) {
          return;
        }
        emitter.emitted[event] = true;
        emitter.emit(event, code, signal);
      };
      sigListeners = {};
      signals.forEach(function(sig) {
        sigListeners[sig] = function listener() {
          if (!processOk(global.process)) {
            return;
          }
          var listeners = process2.listeners(sig);
          if (listeners.length === emitter.count) {
            unload();
            emit2("exit", null, sig);
            emit2("afterexit", null, sig);
            if (isWin && sig === "SIGHUP") {
              sig = "SIGINT";
            }
            process2.kill(process2.pid, sig);
          }
        };
      });
      module.exports.signals = function() {
        return signals;
      };
      loaded = false;
      load = function load2() {
        if (loaded || !processOk(global.process)) {
          return;
        }
        loaded = true;
        emitter.count += 1;
        signals = signals.filter(function(sig) {
          try {
            process2.on(sig, sigListeners[sig]);
            return true;
          } catch (er) {
            return false;
          }
        });
        process2.emit = processEmit;
        process2.reallyExit = processReallyExit;
      };
      module.exports.load = load;
      originalProcessReallyExit = process2.reallyExit;
      processReallyExit = function processReallyExit2(code) {
        if (!processOk(global.process)) {
          return;
        }
        process2.exitCode = code || /* istanbul ignore next */
        0;
        emit2("exit", process2.exitCode, null);
        emit2("afterexit", process2.exitCode, null);
        originalProcessReallyExit.call(process2, process2.exitCode);
      };
      originalProcessEmit = process2.emit;
      processEmit = function processEmit2(ev, arg) {
        if (ev === "exit" && processOk(global.process)) {
          if (arg !== void 0) {
            process2.exitCode = arg;
          }
          var ret = originalProcessEmit.apply(this, arguments);
          emit2("exit", process2.exitCode, null);
          emit2("afterexit", process2.exitCode, null);
          return ret;
        } else {
          return originalProcessEmit.apply(this, arguments);
        }
      };
    }
    var assert;
    var signals;
    var isWin;
    var EE;
    var emitter;
    var unload;
    var emit2;
    var sigListeners;
    var loaded;
    var load;
    var originalProcessReallyExit;
    var processReallyExit;
    var originalProcessEmit;
    var processEmit;
  }
});

// node_modules/proper-lockfile/lib/mtime-precision.js
var require_mtime_precision = __commonJS({
  "node_modules/proper-lockfile/lib/mtime-precision.js"(exports, module) {
    "use strict";
    var cacheSymbol = Symbol();
    function probe(file, fs, callback) {
      const cachedPrecision = fs[cacheSymbol];
      if (cachedPrecision) {
        return fs.stat(file, (err, stat) => {
          if (err) {
            return callback(err);
          }
          callback(null, stat.mtime, cachedPrecision);
        });
      }
      const mtime = new Date(Math.ceil(Date.now() / 1e3) * 1e3 + 5);
      fs.utimes(file, mtime, mtime, (err) => {
        if (err) {
          return callback(err);
        }
        fs.stat(file, (err2, stat) => {
          if (err2) {
            return callback(err2);
          }
          const precision = stat.mtime.getTime() % 1e3 === 0 ? "s" : "ms";
          Object.defineProperty(fs, cacheSymbol, { value: precision });
          callback(null, stat.mtime, precision);
        });
      });
    }
    function getMtime(precision) {
      let now = Date.now();
      if (precision === "s") {
        now = Math.ceil(now / 1e3) * 1e3;
      }
      return new Date(now);
    }
    module.exports.probe = probe;
    module.exports.getMtime = getMtime;
  }
});

// node_modules/proper-lockfile/lib/lockfile.js
var require_lockfile = __commonJS({
  "node_modules/proper-lockfile/lib/lockfile.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var fs = require_graceful_fs();
    var retry = require_retry2();
    var onExit = require_signal_exit();
    var mtimePrecision = require_mtime_precision();
    var locks = {};
    function getLockFile(file, options) {
      return options.lockfilePath || `${file}.lock`;
    }
    function resolveCanonicalPath(file, options, callback) {
      if (!options.realpath) {
        return callback(null, path.resolve(file));
      }
      options.fs.realpath(file, callback);
    }
    function acquireLock(file, options, callback) {
      const lockfilePath = getLockFile(file, options);
      options.fs.mkdir(lockfilePath, (err) => {
        if (!err) {
          return mtimePrecision.probe(lockfilePath, options.fs, (err2, mtime, mtimePrecision2) => {
            if (err2) {
              options.fs.rmdir(lockfilePath, () => {
              });
              return callback(err2);
            }
            callback(null, mtime, mtimePrecision2);
          });
        }
        if (err.code !== "EEXIST") {
          return callback(err);
        }
        if (options.stale <= 0) {
          return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
        }
        options.fs.stat(lockfilePath, (err2, stat) => {
          if (err2) {
            if (err2.code === "ENOENT") {
              return acquireLock(file, { ...options, stale: 0 }, callback);
            }
            return callback(err2);
          }
          if (!isLockStale(stat, options)) {
            return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
          }
          removeLock(file, options, (err3) => {
            if (err3) {
              return callback(err3);
            }
            acquireLock(file, { ...options, stale: 0 }, callback);
          });
        });
      });
    }
    function isLockStale(stat, options) {
      return stat.mtime.getTime() < Date.now() - options.stale;
    }
    function removeLock(file, options, callback) {
      options.fs.rmdir(getLockFile(file, options), (err) => {
        if (err && err.code !== "ENOENT") {
          return callback(err);
        }
        callback();
      });
    }
    function updateLock(file, options) {
      const lock3 = locks[file];
      if (lock3.updateTimeout) {
        return;
      }
      lock3.updateDelay = lock3.updateDelay || options.update;
      lock3.updateTimeout = setTimeout(() => {
        lock3.updateTimeout = null;
        options.fs.stat(lock3.lockfilePath, (err, stat) => {
          const isOverThreshold = lock3.lastUpdate + options.stale < Date.now();
          if (err) {
            if (err.code === "ENOENT" || isOverThreshold) {
              return setLockAsCompromised(file, lock3, Object.assign(err, { code: "ECOMPROMISED" }));
            }
            lock3.updateDelay = 1e3;
            return updateLock(file, options);
          }
          const isMtimeOurs = lock3.mtime.getTime() === stat.mtime.getTime();
          if (!isMtimeOurs) {
            return setLockAsCompromised(
              file,
              lock3,
              Object.assign(
                new Error("Unable to update lock within the stale threshold"),
                { code: "ECOMPROMISED" }
              )
            );
          }
          const mtime = mtimePrecision.getMtime(lock3.mtimePrecision);
          options.fs.utimes(lock3.lockfilePath, mtime, mtime, (err2) => {
            const isOverThreshold2 = lock3.lastUpdate + options.stale < Date.now();
            if (lock3.released) {
              return;
            }
            if (err2) {
              if (err2.code === "ENOENT" || isOverThreshold2) {
                return setLockAsCompromised(file, lock3, Object.assign(err2, { code: "ECOMPROMISED" }));
              }
              lock3.updateDelay = 1e3;
              return updateLock(file, options);
            }
            lock3.mtime = mtime;
            lock3.lastUpdate = Date.now();
            lock3.updateDelay = null;
            updateLock(file, options);
          });
        });
      }, lock3.updateDelay);
      if (lock3.updateTimeout.unref) {
        lock3.updateTimeout.unref();
      }
    }
    function setLockAsCompromised(file, lock3, err) {
      lock3.released = true;
      if (lock3.updateTimeout) {
        clearTimeout(lock3.updateTimeout);
      }
      if (locks[file] === lock3) {
        delete locks[file];
      }
      lock3.options.onCompromised(err);
    }
    function lock2(file, options, callback) {
      options = {
        stale: 1e4,
        update: null,
        realpath: true,
        retries: 0,
        fs,
        onCompromised: (err) => {
          throw err;
        },
        ...options
      };
      options.retries = options.retries || 0;
      options.retries = typeof options.retries === "number" ? { retries: options.retries } : options.retries;
      options.stale = Math.max(options.stale || 0, 2e3);
      options.update = options.update == null ? options.stale / 2 : options.update || 0;
      options.update = Math.max(Math.min(options.update, options.stale / 2), 1e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const operation = retry.operation(options.retries);
        operation.attempt(() => {
          acquireLock(file2, options, (err2, mtime, mtimePrecision2) => {
            if (operation.retry(err2)) {
              return;
            }
            if (err2) {
              return callback(operation.mainError());
            }
            const lock3 = locks[file2] = {
              lockfilePath: getLockFile(file2, options),
              mtime,
              mtimePrecision: mtimePrecision2,
              options,
              lastUpdate: Date.now()
            };
            updateLock(file2, options);
            callback(null, (releasedCallback) => {
              if (lock3.released) {
                return releasedCallback && releasedCallback(Object.assign(new Error("Lock is already released"), { code: "ERELEASED" }));
              }
              unlock(file2, { ...options, realpath: false }, releasedCallback);
            });
          });
        });
      });
    }
    function unlock(file, options, callback) {
      options = {
        fs,
        realpath: true,
        ...options
      };
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const lock3 = locks[file2];
        if (!lock3) {
          return callback(Object.assign(new Error("Lock is not acquired/owned by you"), { code: "ENOTACQUIRED" }));
        }
        lock3.updateTimeout && clearTimeout(lock3.updateTimeout);
        lock3.released = true;
        delete locks[file2];
        removeLock(file2, options, callback);
      });
    }
    function check(file, options, callback) {
      options = {
        stale: 1e4,
        realpath: true,
        fs,
        ...options
      };
      options.stale = Math.max(options.stale || 0, 2e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        options.fs.stat(getLockFile(file2, options), (err2, stat) => {
          if (err2) {
            return err2.code === "ENOENT" ? callback(null, false) : callback(err2);
          }
          return callback(null, !isLockStale(stat, options));
        });
      });
    }
    function getLocks() {
      return locks;
    }
    onExit(() => {
      for (const file in locks) {
        const options = locks[file].options;
        try {
          options.fs.rmdirSync(getLockFile(file, options));
        } catch (e) {
        }
      }
    });
    module.exports.lock = lock2;
    module.exports.unlock = unlock;
    module.exports.check = check;
    module.exports.getLocks = getLocks;
  }
});

// node_modules/proper-lockfile/lib/adapter.js
var require_adapter = __commonJS({
  "node_modules/proper-lockfile/lib/adapter.js"(exports, module) {
    "use strict";
    var fs = require_graceful_fs();
    function createSyncFs(fs2) {
      const methods = ["mkdir", "realpath", "stat", "rmdir", "utimes"];
      const newFs = { ...fs2 };
      methods.forEach((method) => {
        newFs[method] = (...args) => {
          const callback = args.pop();
          let ret;
          try {
            ret = fs2[`${method}Sync`](...args);
          } catch (err) {
            return callback(err);
          }
          callback(null, ret);
        };
      });
      return newFs;
    }
    function toPromise(method) {
      return (...args) => new Promise((resolve4, reject) => {
        args.push((err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve4(result);
          }
        });
        method(...args);
      });
    }
    function toSync(method) {
      return (...args) => {
        let err;
        let result;
        args.push((_err, _result) => {
          err = _err;
          result = _result;
        });
        method(...args);
        if (err) {
          throw err;
        }
        return result;
      };
    }
    function toSyncOptions(options) {
      options = { ...options };
      options.fs = createSyncFs(options.fs || fs);
      if (typeof options.retries === "number" && options.retries > 0 || options.retries && typeof options.retries.retries === "number" && options.retries.retries > 0) {
        throw Object.assign(new Error("Cannot use retries with the sync api"), { code: "ESYNC" });
      }
      return options;
    }
    module.exports = {
      toPromise,
      toSync,
      toSyncOptions
    };
  }
});

// node_modules/proper-lockfile/index.js
var require_proper_lockfile = __commonJS({
  "node_modules/proper-lockfile/index.js"(exports, module) {
    "use strict";
    var lockfile = require_lockfile();
    var { toPromise, toSync, toSyncOptions } = require_adapter();
    async function lock2(file, options) {
      const release = await toPromise(lockfile.lock)(file, options);
      return toPromise(release);
    }
    function lockSync(file, options) {
      const release = toSync(lockfile.lock)(file, toSyncOptions(options));
      return toSync(release);
    }
    function unlock(file, options) {
      return toPromise(lockfile.unlock)(file, options);
    }
    function unlockSync(file, options) {
      return toSync(lockfile.unlock)(file, toSyncOptions(options));
    }
    function check(file, options) {
      return toPromise(lockfile.check)(file, options);
    }
    function checkSync(file, options) {
      return toSync(lockfile.check)(file, toSyncOptions(options));
    }
    module.exports = lock2;
    module.exports.lock = lock2;
    module.exports.unlock = unlock;
    module.exports.lockSync = lockSync;
    module.exports.unlockSync = unlockSync;
    module.exports.check = check;
    module.exports.checkSync = checkSync;
  }
});

// src/shared/exit-codes.ts
var EXIT = {
  /** Success. */
  OK: 0,
  /** Generic failure (uncaught error, classified drop, gate/verify failure). */
  ERROR: 1,
  /** Usage error: unknown subcommand/hook, bad flags, missing required arg. */
  USAGE: 2,
  /** Conflict: an active run already exists and no resolution flag was passed. */
  CONFLICT: 3
};

// src/shared/logging.ts
var LEVEL_RANK = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};
function activeThreshold() {
  const raw = (process.env.FACTORY_LOG_LEVEL ?? "").trim().toLowerCase();
  if (raw && raw in LEVEL_RANK) {
    return LEVEL_RANK[raw];
  }
  if (process.env.FACTORY_QUIET === "1") {
    return LEVEL_RANK.error;
  }
  return LEVEL_RANK.info;
}
function emit(level, scope, args) {
  if (LEVEL_RANK[level] < activeThreshold()) {
    return;
  }
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const msg = args.map((a) => typeof a === "string" ? a : safeStringify(a)).join(" ");
  process.stderr.write(`[${ts}] [${level.toUpperCase()}] ${scope}: ${msg}
`);
}
function safeStringify(value) {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function createLogger(scope) {
  return {
    debug: (...args) => {
      emit("debug", scope, args);
    },
    info: (...args) => {
      emit("info", scope, args);
    },
    warn: (...args) => {
      emit("warn", scope, args);
    },
    error: (...args) => {
      emit("error", scope, args);
    },
    child: (subScope) => createLogger(`${scope}:${subScope}`)
  };
}
var log = createLogger("factory");

// src/shared/exec.ts
import { spawn } from "node:child_process";
var DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
function exec(command, args = [], opts = {}) {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise((resolve4, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.envMode === "replace" ? opts.env ?? {} : opts.env ? { ...process.env, ...opts.env } : process.env,
      shell: opts.shell ?? false,
      timeout: opts.timeoutMs,
      killSignal: opts.killSignal ?? "SIGTERM"
    });
    const outChunks = [];
    const errChunks = [];
    let outLen = 0;
    let errLen = 0;
    let truncated = false;
    let settled = false;
    const settleReject = (err) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    };
    child.stdout.on("data", (c) => {
      const remaining = maxBuffer - outLen;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (c.length > remaining) {
        outChunks.push(c.subarray(0, remaining));
        outLen = maxBuffer;
        truncated = true;
      } else {
        outChunks.push(c);
        outLen += c.length;
      }
    });
    child.stderr.on("data", (c) => {
      const remaining = maxBuffer - errLen;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (c.length > remaining) {
        errChunks.push(c.subarray(0, remaining));
        errLen = maxBuffer;
        truncated = true;
      } else {
        errChunks.push(c);
        errLen += c.length;
      }
    });
    child.on("error", settleReject);
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve4({
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        code,
        signal: signal ?? null,
        truncated
      });
    });
    if (opts.input !== void 0) {
      child.stdin.on("error", (err) => {
        if (err.code === "EPIPE") {
          return;
        }
        settleReject(err);
      });
      child.stdin.end(opts.input);
    }
  });
}
var ExecError = class extends Error {
  result;
  command;
  args;
  constructor(command, args, result) {
    const where = [command, ...args].join(" ");
    super(
      `command failed (code=${result.code ?? "null"}` + (result.signal ? `, signal=${result.signal}` : "") + `): ${where}
${result.stderr.trim()}`
    );
    this.name = "ExecError";
    this.command = command;
    this.args = args;
    this.result = result;
  }
};

// src/shared/atomic-write.ts
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";
function tempPathFor(target) {
  const dir = dirname(target);
  const name = basename(target);
  const rand = randomBytes(6).toString("hex");
  return join(dir, `.${name}.${process.pid}.${rand}.tmp`);
}
async function atomicWriteFile(target, data) {
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = tempPathFor(target);
  const handle = await open(tmp, "w", 384);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (err) {
    await handle.close();
    await bestEffortUnlink(tmp);
    throw err;
  }
  await handle.close();
  try {
    await rename(tmp, target);
  } catch (err) {
    await bestEffortUnlink(tmp);
    throw err;
  }
  try {
    const dirHandle = await open(dir, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
  }
}
async function bestEffortUnlink(p) {
  try {
    await unlink(p);
  } catch {
  }
}

// src/shared/json.ts
var JsonParseError = class extends Error {
  path;
  cause;
  constructor(message, path, cause) {
    super(message);
    this.name = "JsonParseError";
    this.path = path;
    this.cause = cause;
  }
};
function parseJson(text, sourcePath) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    const where = sourcePath != null ? ` (from ${sourcePath})` : "";
    throw new JsonParseError(`invalid JSON${where}: ${cause.message}`, sourcePath, cause);
  }
}
function stringifyJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

// src/shared/fs-errors.ts
function isEnoent(err) {
  return err instanceof Error && err.code === "ENOENT";
}

// src/shared/assert.ts
function nonNull(x, msg) {
  if (x == null) {
    throw new Error(msg ?? "unexpected nullish value");
  }
  return x;
}
function at(a, i) {
  return nonNull(a[i], `index ${i} out of range (length ${a.length})`);
}

// src/shared/time.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}

// src/shared/secret-patterns.ts
var SECRET_CONTENT_PATTERNS = [
  { name: "aws-access-key-id", source: "AKIA[0-9A-Z]{16}" },
  { name: "github-pat-classic", source: "ghp_[A-Za-z0-9]{36}" },
  { name: "github-server-token", source: "ghs_[A-Za-z0-9]{36}" },
  { name: "github-oauth-token", source: "gho_[A-Za-z0-9]{36}" },
  { name: "github-refresh-token", source: "ghr_[A-Za-z0-9]{36}" },
  { name: "anthropic-api-key", source: "sk-ant-(api03-)?[A-Za-z0-9_-]{20,}" },
  { name: "openai-style-key", source: "sk-[A-Za-z0-9]{20,}" },
  { name: "slack-token", source: "xox[bpars]-[A-Za-z0-9-]{10,}" },
  { name: "google-api-key", source: "AIza[A-Za-z0-9_-]{35}" },
  { name: "stripe-live-secret", source: "sk_live_[A-Za-z0-9]{20,}" },
  { name: "stripe-live-restricted", source: "rk_live_[A-Za-z0-9]{20,}" },
  {
    name: "jwt",
    source: "eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]+"
  },
  {
    name: "aws-secret-access-key",
    source: "aws_secret_access_key\\s*=\\s*[A-Za-z0-9/+=]{40}"
  },
  // Quote-anchored detector — EXCLUDED from redaction (see header note).
  { name: "json-private-key", source: '"private_key"\\s*:\\s*"-----BEGIN' },
  { name: "pem-private-key", source: "-----BEGIN ([A-Z]+ )?PRIVATE KEY-----" },
  { name: "github-pat-fine-grained", source: "github_pat_[A-Za-z0-9_]{60,}" },
  { name: "openai-project-key", source: "sk-proj-[A-Za-z0-9_-]{40,}" },
  { name: "nvidia-api-key", source: "nvapi-[A-Za-z0-9_-]{40,}" },
  { name: "xai-api-key", source: "xai-[A-Za-z0-9]{40,}" }
];
function hasLiteralQuote(p) {
  return p.source.includes('"');
}
var SECRET_REDACTION_PATTERNS = SECRET_CONTENT_PATTERNS.filter(
  (p) => !hasLiteralQuote(p)
);
var _KNOWN_PUBLIC_TOKEN_PARTS = [
  // anon role
  [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9",
    "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
  ],
  // service_role
  [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0",
    "EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
  ]
];
var KNOWN_PUBLIC_TOKENS = _KNOWN_PUBLIC_TOKEN_PARTS.map((p) => p.join("."));
function detectSecrets(text) {
  const scrubbed = KNOWN_PUBLIC_TOKENS.reduce((t, tok) => t.split(tok).join(""), text);
  const hits = [];
  for (const p of SECRET_CONTENT_PATTERNS) {
    if (new RegExp(p.source).test(scrubbed)) {
      hits.push(p.name);
    }
  }
  return hits;
}

// src/shared/ids.ts
var ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
function isValidId(id) {
  return ID_PATTERN.test(id);
}
function validateId(id, label = "id") {
  if (id.length === 0) {
    throw new Error(`${label}: empty`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`${label}: invalid (must match ${ID_PATTERN.source}): ${id}`);
  }
  return id;
}

// src/shared/file-lock.ts
var import_proper_lockfile = __toESM(require_proper_lockfile(), 1);
import { mkdir as mkdir2 } from "node:fs/promises";
import { existsSync } from "node:fs";
var log2 = createLogger("lock");
var DEFAULT_FILE_LOCK_TUNING = {
  stale: 15e3,
  // Enough attempts that ≥3 concurrent writers all eventually win their turn.
  retries: 50,
  retryMinTimeout: 20,
  retryMaxTimeout: 500
};
async function withFileLock(opts, fn) {
  if (opts.dirPolicy === "create") {
    await mkdir2(opts.dir, { recursive: true });
  } else if (!existsSync(opts.dir)) {
    throw new Error(`cannot lock ${opts.label} \u2014 dir '${opts.dir}' does not exist`);
  }
  const release = await (0, import_proper_lockfile.lock)(opts.lockfile, {
    realpath: false,
    stale: opts.tuning.stale,
    retries: {
      retries: opts.tuning.retries,
      minTimeout: opts.tuning.retryMinTimeout,
      maxTimeout: opts.tuning.retryMaxTimeout,
      factor: 1.5
    },
    onCompromised: (err) => {
      log2.error(`lock for ${opts.label} was compromised: ${err.message}`);
      throw err;
    }
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

// src/shared/usage-error.ts
var UsageError = class extends Error {
  isUsageError = true;
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
};
function isUsageError(err) {
  return err instanceof UsageError || typeof err === "object" && err !== null && "isUsageError" in err;
}

// src/shared/fs.ts
import { existsSync as existsSync2, realpathSync } from "node:fs";
import { isAbsolute, normalize, resolve, sep } from "node:path";
function canonicalizePath(candidate, cwd = process.cwd()) {
  const abs = isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
  const normalized = normalize(abs);
  try {
    if (existsSync2(normalized)) {
      return realpathSync(normalized);
    }
  } catch {
  }
  const parts = normalized.split(sep);
  for (let cut = parts.length - 1; cut > 0; cut--) {
    const ancestor = parts.slice(0, cut).join(sep) || sep;
    try {
      if (existsSync2(ancestor)) {
        const realAncestor = realpathSync(ancestor);
        const tail = parts.slice(cut).join(sep);
        return tail.length > 0 ? resolve(realAncestor, tail) : realAncestor;
      }
    } catch {
    }
  }
  return normalized;
}

// src/hooks/token-helpers.ts
var SEGMENT_SPLIT_RE = /&&|\|\||;|&|\||\n|\$\(|`|\)/;
function unquote(tok) {
  let t = tok;
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    t = t.slice(1, -1);
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    t = t.slice(1, -1);
  }
  return t;
}
function basenameOf(tok) {
  const parts = tok.split("/");
  return parts[parts.length - 1] ?? tok;
}

// src/hooks/git-args.ts
function parseGitInvocation(command) {
  const ENV_PREFIX_RE2 = /^([A-Za-z_][A-Za-z0-9_]*)=/;
  const tokens = [];
  const envNames = [];
  for (const tok of command.split(/\s+/)) {
    if (tok.length === 0) {
      continue;
    }
    const m = ENV_PREFIX_RE2.exec(tok);
    if (m) {
      envNames.push(nonNull(m[1]));
      continue;
    }
    tokens.push(tok);
  }
  const result = {
    subcommand: null,
    workDir: "",
    gitDir: "",
    destBranch: "",
    namedArg: "",
    isForce: false,
    isPlusRef: false,
    isHardReset: false,
    sawRemote: false,
    envNames
  };
  const n = tokens.length;
  let i = 0;
  let foundGit = false;
  while (i < n) {
    if (basenameOf(at(tokens, i)) === "git") {
      foundGit = true;
      i++;
      break;
    }
    i++;
  }
  if (!foundGit) {
    return result;
  }
  while (i < n) {
    const tok = at(tokens, i);
    if (tok === "-C") {
      if (i + 1 < n) {
        result.workDir = at(tokens, i + 1);
      }
      i += 2;
      continue;
    }
    if (tok === "-c") {
      i += 2;
      continue;
    }
    if (tok.startsWith("--git-dir=")) {
      result.gitDir = tok.slice("--git-dir=".length);
      i++;
      continue;
    }
    if (tok === "--git-dir" || tok === "--work-tree") {
      if (tok === "--git-dir" && i + 1 < n) {
        result.gitDir = at(tokens, i + 1);
      }
      i += 2;
      continue;
    }
    if (tok.startsWith("-")) {
      i++;
      continue;
    }
    result.subcommand = tok;
    i++;
    break;
  }
  if (result.subcommand === null) {
    return result;
  }
  let pushIsDelete = false;
  while (i < n) {
    const tok = unquote(at(tokens, i));
    switch (result.subcommand) {
      case "push": {
        if (tok === "--force" || tok === "-f" || tok === "--force-with-lease" || tok.startsWith("--force-with-lease=") || tok === "--force-if-includes" || tok.startsWith("--force-if-includes=")) {
          result.isForce = true;
          break;
        }
        if (tok === "--delete" || tok === "-d") {
          pushIsDelete = true;
          break;
        }
        if (tok.startsWith("-")) {
          break;
        }
        if (!result.sawRemote) {
          result.sawRemote = true;
          break;
        }
        if (pushIsDelete) {
          if (result.namedArg.length === 0) {
            result.namedArg = tok;
          }
          break;
        }
        let stripped = tok;
        if (stripped.startsWith("+")) {
          result.isPlusRef = true;
          stripped = stripped.slice(1);
        }
        if (stripped.includes(":")) {
          stripped = stripped.slice(stripped.lastIndexOf(":") + 1);
        }
        if (stripped.startsWith("refs/heads/")) {
          stripped = stripped.slice("refs/heads/".length);
        }
        result.destBranch = stripped;
        break;
      }
      case "reset": {
        if (tok === "--hard") {
          result.isHardReset = true;
        }
        break;
      }
      case "branch": {
        if (tok === "-D" || tok === "-d" || tok === "--delete") {
          for (let j = i + 1; j < n; j++) {
            const nt = unquote(at(tokens, j));
            if (nt.startsWith("-")) {
              continue;
            }
            result.namedArg = nt;
            break;
          }
        }
        break;
      }
      default:
        break;
    }
    i++;
  }
  return result;
}

// src/hooks/shell-bypass.ts
var Q = `["']`;
var BOUNDARY = "(^|[\\s|;&])";
var BYPASS_PATTERNS = [
  {
    // bash/sh/zsh -[flags] '<cmd>' (quoted arg) — `(bash|sh|zsh) -lic '...'`.
    name: "nested-shell-quoted",
    re: new RegExp(`${BOUNDARY}(bash|sh|zsh)\\s+(-[A-Za-z]+\\s+)?${Q}[^"']+${Q}`)
  },
  {
    // env [VAR=val …] (bash|sh|zsh)  — `env bash -c`, `env -i sh -c`, `X=1 env zsh`.
    name: "env-wrapped-shell",
    re: new RegExp(`${BOUNDARY}env(\\s+-[A-Za-z]+)*(\\s+[A-Za-z_][A-Za-z0-9_]*=[^\\s]*)*\\s+(bash|sh|zsh)(\\s|$)`)
  },
  {
    // env [flags] '<cmd>' (quoted) — `env 'some cmd'`.
    name: "env-quoted",
    re: new RegExp(`${BOUNDARY}env(\\s+-[A-Za-z]+\\s+)?${Q}[^"']+${Q}`)
  },
  {
    // Unquoted shell script invocation: `bash some/path.sh ...` (next char is
    // non-flag, non-space). NOTE the bash class `[^-[:space:]]`.
    name: "nested-shell-script",
    re: new RegExp(`${BOUNDARY}(bash|sh|zsh)\\s+[^-\\s]`)
  },
  {
    // Heredoc/here-string into a shell: `/bin/sh << EOF`, `sh -s <<<"..."`,
    // `bash -eu <<EOF`. The `(/[^\\s]*/)?` matches a path PREFIX as a whole
    // component (trailing slash) so `/bin/sh` is caught but `evil.sh` is not.
    name: "heredoc-into-shell",
    re: new RegExp(`${BOUNDARY}(/[^\\s]*/)?(bash|sh|zsh)(\\s+-[^\\s<]+)*\\s*<<`)
  },
  {
    // Pipe whose sink is a shell: `... | bash`, `cat x | /bin/sh`. Same path-
    // component prefix so `/usr/bin/sh` matches but `transform.sh` does not.
    name: "pipe-to-shell",
    re: new RegExp(`\\|\\s*(/[^\\s]*/)?(bash|sh|zsh)(\\s|$)`)
  },
  {
    // Env-prefix injection of a shell-affecting var (BASH_ENV/ENV/SHELLOPTS/
    // BASH_FUNC_<name>%*), anchored to a command boundary so a quoted `set ENV=`
    // inside an arg is not matched. Leading benign assignments are swallowed.
    name: "env-injection",
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex false positive: the `(…=…\s+)*` chunks parse deterministically (disjoint classes, literal `=`); ReDoS-audited linear (~1ms on 50k-char pathological input)
    re: new RegExp(
      "(^\\s*|[;&|]\\s*)([A-Za-z_][A-Za-z0-9_]*=[^\\s]*\\s+)*(BASH_ENV|ENV|SHELLOPTS|BASH_FUNC_[A-Za-z0-9_]+%*)="
    )
  },
  {
    // ev-al (spelled split in the bash to dodge scanners) — `eval ...`.
    name: "eval",
    re: new RegExp(`${BOUNDARY}eval(\\s|$)`)
  },
  {
    // git -c hooksPath= / -c core.hooksPath= (overrides hooks for the next op).
    name: "git-hookspath-override",
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex false positive: `(-[^\s]+\s+)*` chunks parse deterministically; ReDoS-audited linear (<1ms on 50k-char pathological input)
    re: /git\s+(-[^\s]+\s+)*-c\s+(core\.)?hooksPath=/
  },
  {
    // Direct absolute-path shell with a quoted -flag arg: `/bin/sh -c '...'`,
    // `/usr/bin/env bash -c '...'`.
    name: "abs-path-shell",
    re: new RegExp(`/(bin|usr/bin)/(bash|sh|zsh|env)\\s+-[A-Za-z]+\\s+${Q}`)
  }
];
function isNestedShellOrHookBypass(cmd) {
  if (cmd.length === 0) {
    return false;
  }
  return BYPASS_PATTERNS.some((p) => p.re.test(cmd));
}

// src/autonomy/mode.ts
function isAutonomous(env = process.env) {
  return env.FACTORY_AUTONOMOUS_MODE === "1";
}

// src/shared/stdin.ts
async function readStdin(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// src/hooks/hook-io.ts
function allow() {
  return { action: "allow" };
}
function deny(reason, detail) {
  return detail === void 0 ? { action: "deny", reason } : { action: "deny", reason, detail };
}
var HookInputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "HookInputError";
  }
};
function parseHookInput(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new HookInputError(`malformed hook input JSON: ${err.message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HookInputError("hook input must be a JSON object");
  }
  return parsed;
}
function commandOf(input) {
  return input?.tool_input?.command ?? "";
}
function toolNameOf(input) {
  return input?.tool_name ?? "";
}
function sessionIdOf(input) {
  const v = input?.session_id;
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function filePathsOf(input) {
  const ti = input?.tool_input;
  if (!ti) {
    return [];
  }
  const out = [];
  if (typeof ti.file_path === "string" && ti.file_path.length > 0) {
    out.push(ti.file_path);
  }
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) {
      if (e && typeof e.file_path === "string" && e.file_path.length > 0) {
        out.push(e.file_path);
      }
    }
  }
  return [...new Set(out)];
}
function emitPermissionDecision(decision, write = (s) => process.stdout.write(s)) {
  if (decision.action !== "deny") {
    return "";
  }
  const reason = decision.detail != null && decision.detail.length > 0 ? `${decision.reason}: ${decision.detail}` : decision.reason;
  const payload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  });
  write(payload + "\n");
  return payload;
}
function emitBlockDecision(decision, write = (s) => process.stderr.write(s)) {
  if (decision.action !== "deny") {
    return "";
  }
  const payload = JSON.stringify(
    decision.detail != null && decision.detail.length > 0 ? { decision: "block", reason: decision.reason, detail: decision.detail } : { decision: "block", reason: decision.reason }
  );
  write(payload + "\n");
  return payload;
}
function emitSessionStartContext(additionalContext, write = (s) => process.stdout.write(s)) {
  const payload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext
    }
  });
  write(payload + "\n");
  return payload;
}
function decisionToExitCode(decision) {
  return decision.action === "deny" ? EXIT.ERROR : EXIT.OK;
}

// src/hooks/branch-protection.ts
var PROTECTED_BRANCHES = [
  "main",
  "master",
  "develop",
  "staging",
  "production",
  "release",
  "prod"
];
var PIPELINE_MANAGED_BRANCHES = ["staging"];
var log3 = createLogger("branch-protection");
function isProtectedBranch(name) {
  return PROTECTED_BRANCHES.includes(name);
}
function inOrchestratorWorktree(cwd) {
  return cwd.includes("/.claude/worktrees/orchestrator-");
}
function pipelineCanWrite(branch, cwd, autonomousMode) {
  if (!autonomousMode) {
    return false;
  }
  if (!PIPELINE_MANAGED_BRANCHES.includes(branch)) {
    return false;
  }
  return inOrchestratorWorktree(cwd);
}
function makeDefaultResolver(execFn) {
  return async (inv) => {
    const args = [];
    if (inv.workDir) {
      args.push("-C", inv.workDir);
    }
    if (inv.gitDir) {
      args.push("--git-dir", inv.gitDir);
    }
    args.push("symbolic-ref", "--short", "HEAD");
    try {
      const r = await execFn("git", args, {});
      if (r.code === 0) {
        return r.stdout.trim();
      }
      return "";
    } catch (err) {
      log3.warn(
        `current-branch resolution failed (${err.message}); treating as unprotected \u2014 a protected-branch guard may not apply`
      );
      return "";
    }
  };
}
async function decideBranchProtection(input, deps = {}) {
  const command = commandOf(input);
  if (command.length === 0) {
    return allow();
  }
  const cwd = deps.cwd ?? process.cwd();
  const autonomousMode = deps.autonomousMode ?? isAutonomous();
  if (autonomousMode && isNestedShellOrHookBypass(command)) {
    return deny("nested_shell_denied", `nested-shell or hook-bypass not allowed in autonomous mode: ${command}`);
  }
  const inv = parseGitInvocation(command);
  if (inv.subcommand === null) {
    return allow();
  }
  const execFn = deps.exec ?? exec;
  const resolveCurrent = deps.resolveCurrentBranch ?? makeDefaultResolver(execFn);
  if (inv.subcommand === "push") {
    const current = await resolveCurrent(inv);
    if (current.length > 0 && isProtectedBranch(current)) {
      if (inv.destBranch.length === 0 || inv.destBranch === current) {
        if (!pipelineCanWrite(current, cwd, autonomousMode)) {
          return deny("on_protected_branch", `currently on '${current}' \u2014 push will publish to protected`);
        }
      }
    }
  }
  if (inv.subcommand === "push" && inv.isForce) {
    if (inv.destBranch.length > 0 && isProtectedBranch(inv.destBranch)) {
      return deny("force_push_protected", `force-push targets protected branch '${inv.destBranch}'`);
    }
  }
  if (inv.subcommand === "push" && inv.isPlusRef) {
    if (inv.destBranch.length > 0 && isProtectedBranch(inv.destBranch)) {
      return deny(
        "force_push_refspec_protected",
        `+refspec force-push targets protected branch '${inv.destBranch}'`
      );
    }
  }
  if (inv.subcommand === "push") {
    if (inv.destBranch.length > 0 && isProtectedBranch(inv.destBranch)) {
      if (!pipelineCanWrite(inv.destBranch, cwd, autonomousMode)) {
        return deny("push_to_protected", `push targets protected branch '${inv.destBranch}'`);
      }
    }
  }
  if (inv.subcommand === "push" && inv.namedArg.length > 0) {
    if (isProtectedBranch(inv.namedArg)) {
      return deny("remote_delete_protected", `remote deletion of protected branch '${inv.namedArg}'`);
    }
  }
  if (inv.subcommand === "reset" && inv.isHardReset) {
    const current = await resolveCurrent(inv);
    if (current.length > 0 && isProtectedBranch(current)) {
      if (!pipelineCanWrite(current, cwd, autonomousMode)) {
        return deny("hard_reset_on_protected", `hard reset while on protected branch '${current}'`);
      }
    }
  }
  if (inv.subcommand === "branch" && inv.namedArg.length > 0) {
    if (isProtectedBranch(inv.namedArg)) {
      return deny("delete_protected_branch", `deletion of protected branch '${inv.namedArg}'`);
    }
  }
  return allow();
}
async function runBranchProtection(_argv = [], deps = {}) {
  let input;
  try {
    const raw = deps.readRaw ? await deps.readRaw() : await readStdin();
    input = parseHookInput(raw);
  } catch {
    const decision2 = deny("malformed_hook_input", "branch-protection: unparseable hook input");
    emitPermissionDecision(decision2);
    return EXIT.ERROR;
  }
  const decision = await decideBranchProtection(input, deps);
  emitPermissionDecision(decision);
  return decisionToExitCode(decision);
}

// src/config/load.ts
import { existsSync as existsSync3, readFileSync } from "node:fs";
import { basename as basename2, dirname as dirname2, join as join2, resolve as resolve2, sep as sep2 } from "node:path";
import { homedir } from "node:os";

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever2(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever2;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/config/schema.ts
var EffortEnum = external_exports.enum(["low", "medium", "high", "xhigh", "max"]);
var QualitySchema = external_exports.object({
  /** Percent of acceptance criteria held out as an unreadable answer-key. */
  holdoutPercent: external_exports.number().min(0).max(100).default(20),
  /** Min pass-rate (%) on the holdout set to clear the gate. */
  holdoutPassRate: external_exports.number().min(0).max(100).default(80),
  /** Target mutation score (%) for the mutation gate. */
  mutationScoreTarget: external_exports.number().min(0).max(100).default(80),
  /** Allowed coverage regression (percentage points) before the gate fails. */
  coverageRegressionTolerancePct: external_exports.number().min(0).default(0.5),
  /** Optional custom SAST/security command (else the built-in semgrep run). */
  securityCommand: external_exports.string().optional(),
  /** Treat security findings as non-blocking when true. */
  securityAllowFailures: external_exports.boolean().default(false),
  /** Redact secrets from the persisted findings artifact (on by default). */
  securityRedactFindings: external_exports.boolean().default(true),
  /**
   * Per-worktree environment-prep command run once after the task worktree is
   * created, BEFORE the deterministic command-gates (test/type/build). When
   * unset, a lockfile in the worktree is auto-detected (`package-lock.json` →
   * `npm ci`, `pnpm-lock.yaml`/`yarn.lock` → frozen install); a repo with no
   * lockfile is a no-op. Set this for non-JS repos or custom setups. Optional.
   */
  setupCommand: external_exports.string().optional(),
  /**
   * Env vars injected into EVERY deterministic gate command (build/test/type/
   * lint/security), merged over `process.env`. Mirror the repo's CI build-step
   * env (e.g. the placeholders a Next.js static prerender needs) so the verifier
   * floor measures the code, not a missing-env build crash. Placeholders only —
   * NOT a secret store. Values are required strings (an explicit "set this var");
   * a numeric-looking value must be quoted as JSON at the `--set` boundary.
   */
  gateEnv: external_exports.record(external_exports.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "valid POSIX env name"), external_exports.string()).default({})
}).default({});
function nonDecreasing(xs) {
  return xs.every((x, i) => i === 0 || x >= at(xs, i - 1));
}
var QuotaSchema = external_exports.object({
  /** 5h-window utilization checkpoints by hour 1..5 (% caps, non-decreasing). */
  hourlyThresholds: external_exports.array(external_exports.number().min(0).max(100)).length(5).refine(nonDecreasing, { message: "thresholds must be non-decreasing" }).default([20, 40, 60, 80, 90]),
  /** 7d-window utilization checkpoints by day 1..7 (% caps, non-decreasing). Ramps to 95% by day 5, plateaus through days 6–7 (5% end-of-window reserve). */
  dailyThresholds: external_exports.array(external_exports.number().min(0).max(100)).length(7).refine(nonDecreasing, { message: "thresholds must be non-decreasing" }).default([20, 40, 60, 80, 95, 95, 95]),
  /**
   * Producer-model dial keyed by risk tier (Decision 25). The quota-router (the
   * renamed model-router, narrowed) selects the producer model for a task from
   * its risk tier; this is the ONLY dial it carries — the review panel is
   * risk-INVARIANT (Decision 25/26), so there is NO review-depth/round cap here
   * (the old `--tier` routine/feature/security review caps are DELETED).
   * Defaults: low/medium→sonnet (balanced), high→opus (strong). low defaults to
   * SONNET, not haiku — even low-risk work is code generation, which haiku
   * underperforms; override `producerModels.low` per-repo for cheaper low-risk runs.
   */
  producerModels: external_exports.object({
    low: external_exports.string().default("claude-sonnet-4-5"),
    medium: external_exports.string().default("claude-sonnet-4-5"),
    high: external_exports.string().default("claude-opus-4-6")
  }).default({})
}).default({});
var SpecSchema = external_exports.object({
  /**
   * The SINGLE spec-review pass threshold out of 60 (Δ I — resolves the legacy
   * 54-vs-56 conflict in favor of 56). `total >= passReviewThreshold` is a
   * candidate PASS, still subject to the per-dimension floor below.
   */
  passReviewThreshold: external_exports.number().int().min(0).max(60).default(56),
  /**
   * Any-dimension auto-fail floor (Δ I): a single rubric dimension scoring
   * `<= dimensionFloor` forces NEEDS_REVISION regardless of the total.
   */
  dimensionFloor: external_exports.number().int().min(0).max(10).default(5),
  /** Max spec generate→review revision iterations before a loud give-up. */
  maxRegenIterations: external_exports.number().int().positive().default(5),
  /** Max bytes of PRD body retained from `gh issue view` before truncation. */
  prdBodyMaxBytes: external_exports.number().int().positive().default(64 * 1024)
}).default({});
var SPEC_DEFAULTS = Object.freeze(SpecSchema.parse({}));
var ReviewSchema = external_exports.object({
  /** Reviewer model id (panel runs on a fixed model per Decision 26). */
  model: external_exports.string().optional(),
  /**
   * Policy when NO cross-vendor (Codex) reviewer is available (S5/C):
   * `warn` records the absence loudly (task state + report + summary);
   * `block` additionally fails the merge gate — a task cannot ship without an
   * independent second-vendor review.
   */
  requireCrossVendor: external_exports.enum(["warn", "block"]).default("warn")
}).default({});
var CodexSchema = external_exports.object({
  model: external_exports.string().optional()
}).default({});
var GitSchema = external_exports.object({
  /**
   * The durable base branch staging forks from and rolls up into. NEVER
   * `main` (Decision 12/16 — the factory never touches main; promotion to main
   * is human-owned and out of scope).
   */
  baseBranch: external_exports.string().min(1).default("develop"),
  /**
   * Required status-check contexts of develop's RUN PROFILE — under
   * `developProtection: "run-scoped"` (default) they are escalated onto
   * develop for the duration of a run (Decision 74); under `"permanent"`
   * they are asserted at scaffold and provisioned with `--provision`.
   * Defaults to the three contexts the rendered quality-gate workflow
   * always reports (Decision 53) — the rollup PR cannot merge red.
   */
  developRequiredStatusChecks: external_exports.array(external_exports.string()).default(["Quality", "Mutation Testing", "Security Scan"]),
  /**
   * Lifecycle of develop's protection profile (Decision 74).
   * `run-scoped` (default): scaffold writes/asserts only the light BASELINE —
   * `developBaselineStatusChecks` required for non-admins, strict off,
   * `enforce_admins` OFF so repo admins can push straight to develop; `run
   * create` escalates to the strict run profile (`developRequiredStatusChecks`
   * + strict + enforce_admins) and every run-terminal path drops back to
   * baseline. `permanent`: the strict profile is provisioned at scaffold and
   * never removed (pre-D74 behavior). NOTE (run-scoped): escalation and
   * de-escalation are full-replace PUTs — custom hand-made protection on
   * develop is clobbered; use `permanent` to opt out.
   */
  developProtection: external_exports.enum(["run-scoped", "permanent"]).default("run-scoped"),
  /**
   * Required status-check contexts of develop's BASELINE profile (run-scoped
   * mode, Decision 74) — enforced on non-admin PRs into develop while NO run
   * is active. Admins bypass (baseline sets `enforce_admins: false`).
   * DERIVED default: `developRequiredStatusChecks` minus `'Mutation Testing'`
   * (the GitSchema transform below) — the baseline drops exactly the mutation
   * gate, so a custom context added to the run profile (e.g. a repo's pgTAP
   * check) stays required at rest with no double-bookkeeping. An explicitly
   * set value (including `[]`) overrides the derivation.
   */
  developBaselineStatusChecks: external_exports.array(external_exports.string()).optional(),
  /**
   * Required status-check contexts provisioned onto each per-run
   * `staging-<run-id>` branch at run create. Default EMPTY: the engine's
   * local GateRunner is the primary task-level enforcement, and a required
   * check here would make every task-PR merge wait on CI wall-clock.
   */
  stagingRequiredStatusChecks: external_exports.array(external_exports.string()).default([]),
  /**
   * Opt-in protection provisioning. OFF by default — the run VERIFIES and
   * REFUSES when protection is missing (#2 / Δ A); only `--provision` flips
   * this to issue the `gh api` PUT.
   */
  provision: external_exports.boolean().default(false),
  /**
   * Branch-name prefix for run-scoped task branches (Δ M). The full name is
   * `<branchPrefix>/<run_id>/<task_id>`.
   */
  branchPrefix: external_exports.string().min(1).default("factory"),
  /**
   * Outer bound (minutes) finalize waits for the rollup PR's full-CI gate
   * before giving up with `ci-timeout`. Sized above the slowest expected
   * quality-gate run (mutation on a cold cache); a timeout still parks the
   * run recoverably (`factory resume` re-enters the poll).
   */
  rollupCiWaitMinutes: external_exports.number().int().positive().default(30)
}).transform((git) => ({
  ...git,
  developBaselineStatusChecks: git.developBaselineStatusChecks ?? git.developRequiredStatusChecks.filter((c) => c !== "Mutation Testing")
})).default({});
var E2eConfigSchema = external_exports.object({
  /**
   * OPTIONAL override (Decision 40 D10) of the command that boots the target app,
   * for both Playwright's `webServer` (test runs) and the e2e-author's
   * live-exploration boot. Normally unset — the run-start assessment resolves it.
   */
  startCommand: external_exports.string().optional(),
  /** OPTIONAL override of the base URL the app serves once booted (D10 — normally
   * assessment-resolved). */
  baseURL: external_exports.string().url().optional(),
  /** Max wait for `startCommand` to become ready before the boot is a failure, ms. */
  readyTimeoutMs: external_exports.number().int().positive().default(3e4),
  /**
   * Per-task cap on e2e-triggered reopens (Decision 39). A critical spec still
   * red after this many reopens of its mapped task fails the run outright
   * instead of looping forever.
   */
  reopenCap: external_exports.number().int().nonnegative().default(2)
}).default({});
var ConfigSchema = external_exports.object({
  quality: QualitySchema,
  quota: QuotaSchema,
  spec: SpecSchema,
  review: ReviewSchema,
  codex: CodexSchema,
  git: GitSchema,
  e2e: E2eConfigSchema,
  /**
   * FLOOR of the circuit-breaker threshold: the run aborts when cumulative genuine
   * capability-budget failures reach `max(this, ceil(0.15 × total tasks))` — big
   * task graphs tolerate proportionally more (≤20 tasks behave as a flat cap of 3).
   * The signal is run-cumulative, not strictly consecutive (the breaker gate counts
   * total capability-budget drops); the field keeps its name for config back-compat.
   */
  maxConsecutiveFailures: external_exports.number().int().positive().default(3),
  /**
   * How many tasks the runner may have in flight at once. Surfaced to the
   * runner on the `kind:"work"` envelope as `max_parallel` (the runner reads
   * the envelope, never this file). Min 1 (1 = sequential, today's behavior).
   */
  maxParallelTasks: external_exports.number().int().positive().default(3),
  /**
   * Minutes an in-flight spawn (`task.spawn_in_flight.spawned_at`) may age
   * before `next-task` flags it in `work.stale` (advisory — a hung agent that
   * died silently is never re-driven inside a live session otherwise). Default
   * 15: stalls are the #1 operational pain (design-review-2026-07-07). Also
   * sizes the runner's heartbeat cron, so keep it under 60 (the usage-cache
   * staleness ceiling — pipeline-runner SKILL).
   */
  stallTtlMinutes: external_exports.number().int().positive().default(15),
  /**
   * HARD wall-clock cap (minutes) on one in-flight spawn. Past this age
   * `next-task` lists the task in `work.hung` (disjoint from `stale`): the
   * runner kills the spawn's agents EVEN IF ALIVE and re-drives — bounded by
   * SPAWN_REDRIVE_CAP (orchestrator.ts), after which the task fails
   * `blocked-environmental` and finalize/rescue-auto take over (Decision 66).
   * Must exceed stallTtlMinutes (the advisory liveness-checked tier below
   * it) — enforced by the superRefine below.
   */
  hungSpawnMinutes: external_exports.number().int().positive().default(120)
}).superRefine((cfg, ctx) => {
  if (cfg.hungSpawnMinutes <= cfg.stallTtlMinutes) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["hungSpawnMinutes"],
      message: `hungSpawnMinutes (${cfg.hungSpawnMinutes}) must exceed stallTtlMinutes (${cfg.stallTtlMinutes}) \u2014 the hard kill-even-if-alive tier sits above the advisory liveness-checked stale band`
    });
  }
}).default({});

// src/config/load.ts
var log4 = createLogger("config");
var PLUGIN_NAME = "factory";
var warnedRedirects = /* @__PURE__ */ new Set();
function expectedDataDir(opts) {
  const { current, home, pluginRoot, warn } = opts;
  if (current == null || current.length === 0) {
    return null;
  }
  const dataRoot = join2(home, ".claude", "plugins", "data");
  if (!current.startsWith(dataRoot + sep2)) {
    return null;
  }
  const currentBase = basename2(current);
  if (currentBase === PLUGIN_NAME || currentBase.startsWith(`${PLUGIN_NAME}-`)) {
    return null;
  }
  const pluginFromPath = basename2(dirname2(pluginRoot));
  const marketplaceFromPath = basename2(dirname2(dirname2(pluginRoot)));
  const cacheAnchor = resolve2(pluginRoot, "..", "..", "..");
  const expectedCacheRoot = join2(home, ".claude", "plugins", "cache");
  if (cacheAnchor === expectedCacheRoot && pluginFromPath.length > 0 && marketplaceFromPath.length > 0) {
    return join2(dataRoot, `${pluginFromPath}-${marketplaceFromPath}`);
  }
  const marketplaceJson = join2(pluginRoot, ".claude-plugin", "marketplace.json");
  if (existsSync3(marketplaceJson)) {
    try {
      const parsed = parseJson(readFileSync(marketplaceJson, "utf8"), marketplaceJson);
      const name = parsed !== null && typeof parsed === "object" ? parsed.name : void 0;
      const marketplaceName = typeof name === "string" ? name : "";
      if (marketplaceName.length > 0) {
        return join2(dataRoot, `${PLUGIN_NAME}-${marketplaceName}`);
      }
    } catch (err) {
      warn(
        `could not parse ${marketplaceJson} (${err.message}); cannot canonicalize the foreign-plugin data dir \u2014 state may land in a foreign directory. Set CLAUDE_PLUGIN_DATA explicitly to factory's own data dir.`
      );
    }
  }
  return null;
}
function inferPluginRoot() {
  try {
    const here = new URL(".", import.meta.url).pathname;
    let dir = here;
    for (let i = 0; i < 4; i++) {
      if (existsSync3(join2(dir, ".claude-plugin"))) {
        return dir;
      }
      dir = dirname2(dir);
    }
    return resolve2(here, "..");
  } catch (err) {
    log4.debug(`inferPluginRoot: ${err.message}; falling back to cwd`);
    return process.cwd();
  }
}
function resolveDataDir(opts = {}) {
  if (opts.dataDir != null && opts.dataDir.length > 0) {
    return resolve2(opts.dataDir);
  }
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const pluginRoot = opts.pluginRoot ?? inferPluginRoot();
  const current = env.CLAUDE_PLUGIN_DATA;
  const warn = opts.warn ?? ((m) => {
    log4.warn(m);
  });
  const notifyRedirect = opts.warn ?? ((m) => {
    log4.debug(m);
  });
  const corrected = expectedDataDir({ current, home, pluginRoot, warn });
  if (corrected != null && corrected.length > 0 && corrected !== current) {
    const key = JSON.stringify([current ?? "", corrected]);
    if (!warnedRedirects.has(key)) {
      warnedRedirects.add(key);
      notifyRedirect(
        `CLAUDE_PLUGIN_DATA is set to '${current ?? ""}', which belongs to another plugin \u2014 factory auto-redirected to its canonical data dir '${corrected}'. This is benign and self-corrected: no action is required for correctness. To silence this notice permanently, set CLAUDE_PLUGIN_DATA to factory's own dir (e.g. export CLAUDE_PLUGIN_DATA="$HOME/.claude/plugins/data/factory-<your-marketplace-id>").`
      );
    }
    return resolve2(corrected);
  }
  if (current == null || current.length === 0) {
    throw new Error(
      'CLAUDE_PLUGIN_DATA must be set (e.g. export CLAUDE_PLUGIN_DATA="$HOME/.claude/plugins/data/factory-<your-marketplace-id>")'
    );
  }
  return resolve2(current);
}

// src/hooks/tcb.ts
import { resolve as resolve3, sep as sep3 } from "node:path";

// src/shared/gate-config-names.ts
var STRYKER_CONFIG_BASENAMES = [
  "stryker.conf.json",
  "stryker.conf.js",
  "stryker.conf.mjs",
  "stryker.conf.cjs",
  "stryker.config.json",
  "stryker.config.js",
  "stryker.config.mjs",
  "stryker.config.cjs",
  ".stryker.conf.json",
  ".stryker.conf.js",
  ".stryker.conf.mjs",
  ".stryker.conf.cjs",
  ".stryker.config.json",
  ".stryker.config.js",
  ".stryker.config.mjs",
  ".stryker.config.cjs"
];
var DEPENDENCY_CRUISER_CONFIG_BASENAMES = [
  ".dependency-cruiser.json",
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs"
];

// src/hooks/tcb.ts
function isAtOrUnder(p, base) {
  if (p === base) {
    return true;
  }
  return p.startsWith(base.endsWith(sep3) ? base : base + sep3);
}
function hasComponent(absPath, component) {
  return absPath.split(sep3).includes(component);
}
function hasAdjacentComponents(absPath, parent, child) {
  const parts = absPath.split(sep3);
  for (let i = 0; i + 1 < parts.length; i++) {
    if (parts[i] === parent && parts[i + 1] === child) {
      return true;
    }
  }
  return false;
}
function baseName(absPath) {
  const parts = absPath.split(sep3).filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? "";
}
var GATE_CONFIG_BASENAMES = /* @__PURE__ */ new Set([...STRYKER_CONFIG_BASENAMES, ...DEPENDENCY_CRUISER_CONFIG_BASENAMES]);
function buildTcbRules(ctx = {}) {
  const rules = [];
  rules.push({
    category: "ci-workflows",
    describe: ".github/workflows/** (CI / quality-gate machinery)",
    test: (p) => hasAdjacentComponents(p, ".github", "workflows")
  });
  rules.push({
    category: "docs-factory",
    describe: "docs/factory/** (in-repo reviewable spec copy \u2014 F-specloc)",
    test: (p) => hasAdjacentComponents(p, "docs", "factory")
  });
  rules.push({
    category: "gate-contract",
    describe: ".factory/gates.json (the committed gate contract \u2014 Decision 46)",
    test: (p) => hasAdjacentComponents(p, ".factory", "gates.json")
  });
  rules.push({
    category: "scaffold-lock",
    describe: ".factory/scaffold.lock (seed pristine-tracking \u2014 Decision 15)",
    test: (p) => hasAdjacentComponents(p, ".factory", "scaffold.lock")
  });
  rules.push({
    category: "gate-config",
    describe: "gate/CI config (.stryker.config.json, .dependency-cruiser.cjs)",
    test: (p) => GATE_CONFIG_BASENAMES.has(baseName(p))
  });
  if (ctx.repoRoot != null && ctx.repoRoot.length > 0) {
    const hooksDir = canonicalizePath(resolve3(ctx.repoRoot, "hooks"));
    rules.push({
      category: "hooks",
      describe: "hooks/** (the guard hooks \u2014 editing one disables the boundary)",
      test: (p) => isAtOrUnder(p, hooksDir)
    });
  } else {
    rules.push({
      category: "hooks",
      describe: "hooks/** (the guard hooks \u2014 editing one disables the boundary)",
      test: (p) => hasComponent(p, "hooks")
    });
  }
  if (ctx.repoRoot != null && ctx.repoRoot.length > 0) {
    const e2eDir = canonicalizePath(resolve3(ctx.repoRoot, "e2e"));
    rules.push({
      category: "e2e-suite",
      describe: "e2e/** (committed critical e2e suite \u2014 Decision 39)",
      test: (p) => isAtOrUnder(p, e2eDir)
    });
  } else {
    rules.push({
      category: "e2e-suite",
      describe: "e2e/** (committed critical e2e suite \u2014 Decision 39)",
      test: (p) => hasComponent(p, "e2e")
    });
  }
  if (ctx.dataDir != null && ctx.dataDir.length > 0) {
    const runsDir = canonicalizePath(resolve3(ctx.dataDir, "runs"));
    const specsDir = canonicalizePath(resolve3(ctx.dataDir, "specs"));
    rules.push({
      category: "data-runs",
      describe: "<dataDir>/runs/** (run state, holdouts, reviews \u2014 \u0394 Y)",
      test: (p) => isAtOrUnder(p, runsDir)
    });
    rules.push({
      category: "data-specs",
      describe: "<dataDir>/specs/** (durable spec store)",
      test: (p) => isAtOrUnder(p, specsDir)
    });
    const configFile = canonicalizePath(resolve3(ctx.dataDir, "config.json"));
    rules.push({
      category: "data-config",
      describe: "<dataDir>/config.json (operator config \u2014 writing it enables arbitrary shell via setupCommand)",
      test: (p) => p === configFile
    });
  } else {
    rules.push({
      category: "data-runs",
      describe: "**/runs/{holdouts,reviews,state} (run store, dataDir unresolved)",
      test: (p) => hasComponent(p, "holdouts") || hasComponent(p, "reviews")
    });
  }
  return rules;
}
var TCB_DENY = buildTcbRules();
function isTcbProtected(candidatePath, ctx = {}, cwd = process.cwd()) {
  if (candidatePath.length === 0) {
    return null;
  }
  const canonical = canonicalizePath(candidatePath, cwd);
  for (const rule of buildTcbRules(ctx)) {
    if (rule.test(canonical)) {
      return { rule, canonical };
    }
  }
  return null;
}

// src/hooks/write-protection.ts
var log5 = createLogger("write-protection");
var WRITE_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit"]);
var REDIRECT_TARGET_RE = /(?:\d+|&)?>{1,2}\|?\s*("[^"]+"|'[^']+'|[^\s;|&<>()`]+)/g;
var INPUT_REDIRECT_RE = /<+\s*[^\s;|&<>()`]*/g;
var ENV_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
var WRAPPERS = /* @__PURE__ */ new Set(["sudo", "env", "command", "nohup", "time", "nice", "stdbuf", "xargs"]);
function nonFlagArgs(args) {
  return args.filter((a) => !a.startsWith("-"));
}
function destArgs(args) {
  const out = [];
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = nonNull(args[i]);
    if (a === "-t" || a === "--target-directory") {
      const v = args[i + 1];
      if (v !== void 0) {
        out.push(v);
      }
      i++;
    } else if (a.startsWith("--target-directory=")) {
      out.push(a.slice("--target-directory=".length));
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }
  const last = positional[positional.length - 1];
  if (last !== void 0) {
    out.push(last);
  }
  return out;
}
function inPlaceArgs(args) {
  const inPlace = args.some((a) => a.startsWith("--in-place") || /^-[A-Za-z0-9.]*i/.test(a));
  return inPlace ? nonFlagArgs(args) : [];
}
var WRITE_BINARIES = {
  tee: nonFlagArgs,
  rm: nonFlagArgs,
  // deleting a gate config / workflow neutralizes it as surely as rewriting it
  unlink: nonFlagArgs,
  truncate: nonFlagArgs,
  cp: destArgs,
  mv: destArgs,
  install: destArgs,
  dd: (args) => args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3)),
  sed: inPlaceArgs,
  perl: inPlaceArgs
};
function bashWriteTargets(command) {
  const out = /* @__PURE__ */ new Set();
  for (const m of command.matchAll(REDIRECT_TARGET_RE)) {
    out.add(unquote(nonNull(m[1])));
  }
  for (const seg of command.split(SEGMENT_SPLIT_RE)) {
    const cleaned = seg.replace(REDIRECT_TARGET_RE, " ").replace(INPUT_REDIRECT_RE, " ");
    const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0).map(unquote);
    let i = 0;
    while (i < tokens.length) {
      const tok = nonNull(tokens[i]);
      if (!ENV_PREFIX_RE.test(tok) && !WRAPPERS.has(basenameOf(tok)) && !tok.startsWith("-")) {
        break;
      }
      i++;
    }
    const bin = i < tokens.length ? nonNull(tokens[i]) : void 0;
    const rule = bin === void 0 ? void 0 : WRITE_BINARIES[basenameOf(bin)];
    if (rule) {
      for (const t of rule(tokens.slice(i + 1))) {
        out.add(t);
      }
    }
  }
  return [...out];
}
function resolveTcbContext(deps) {
  const cwd = deps.cwd ?? process.cwd();
  let dataDir;
  try {
    dataDir = resolveDataDir(deps);
  } catch (err) {
    dataDir = void 0;
    log5.warn(
      `TCB data dir unresolved (${err.message}); data-dir write-protection rules are inert \u2014 repo-relative rules still apply`
    );
  }
  return { repoRoot: deps.repoRoot ?? cwd, dataDir };
}
function decideWriteProtection(input, deps = {}) {
  const autonomousMode = deps.autonomousMode ?? isAutonomous();
  if (!autonomousMode) {
    return allow();
  }
  const tool = toolNameOf(input);
  const isBash = tool === "Bash";
  if (!isBash && !WRITE_TOOLS.has(tool)) {
    return allow();
  }
  const targets = isBash ? bashWriteTargets(commandOf(input)) : filePathsOf(input);
  if (targets.length === 0) {
    return allow();
  }
  const ctx = resolveTcbContext(deps);
  const cwd = deps.cwd ?? process.cwd();
  for (const target of targets) {
    const match = isTcbProtected(target, ctx, cwd);
    if (match) {
      return deny(
        "tcb_write_denied",
        `${isBash ? "Bash write" : tool} to TCB-protected path '${match.canonical}' is forbidden (category=${match.rule.category}: ${match.rule.describe})`
      );
    }
  }
  return allow();
}
async function runWriteProtection(_argv = [], deps = {}) {
  let input;
  try {
    const raw = deps.readRaw ? await deps.readRaw() : await readStdin();
    input = parseHookInput(raw);
  } catch {
    const decision2 = deny("malformed_hook_input", "write-protection: unparseable hook input");
    emitPermissionDecision(decision2);
    return EXIT.ERROR;
  }
  const decision = decideWriteProtection(input, deps);
  emitPermissionDecision(decision);
  return decisionToExitCode(decision);
}

// src/hooks/holdout-guard.ts
import { sep as sep4 } from "node:path";
var log6 = createLogger("holdout-guard");
var READ_TOOLS = /* @__PURE__ */ new Set(["Read", "Grep", "Glob"]);
var READ_COMMAND_RE = /\b(cat|less|more|head|tail|grep|egrep|fgrep|rg|sed|awk|od|xxd|hexdump|strings|nl|tac|cut|sort|uniq|jq|yq)\b/;
function isHoldoutPath(canonical) {
  return canonical.split(sep4).includes("holdouts");
}
function readTargetsOf(input) {
  const ti = input?.tool_input ?? {};
  const out = [];
  for (const key of ["file_path", "path", "pattern", "glob"]) {
    const v = ti[key];
    if (typeof v === "string" && v.length > 0) {
      out.push(v);
    }
  }
  return out;
}
function bashPathTokens(cmd) {
  return cmd.split(/[\s;|&><]+/).filter((t) => t.length > 0).filter((t) => !t.startsWith("-"));
}
function decideHoldoutGuard(input, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  let dataDir;
  try {
    dataDir = resolveDataDir(deps);
  } catch (err) {
    dataDir = void 0;
    log6.warn(
      `holdout store dir unresolved (${err.message}); the Bash textual-match arm is inert (no store configured) \u2014 canonical-path denial still applies`
    );
  }
  const tool = toolNameOf(input);
  if (READ_TOOLS.has(tool)) {
    for (const t of readTargetsOf(input)) {
      const canonical = canonicalizePath(t, cwd);
      if (isHoldoutPath(canonical)) {
        return deny(
          "holdout_read_denied",
          `${tool} of the holdout answer-key store ('${canonical}') is forbidden (\u0394 Y)`
        );
      }
    }
    return allow();
  }
  if (tool === "Bash") {
    const cmd = commandOf(input);
    if (cmd.length === 0) {
      return allow();
    }
    const viaReader = READ_COMMAND_RE.test(cmd) ? " via a reader command" : "";
    for (const tokRaw of bashPathTokens(cmd)) {
      const tok = tokRaw.replace(/^["']|["']$/g, "");
      if (!tok.includes("holdouts") && !tok.includes("/") && !tok.includes("..")) {
        continue;
      }
      const canonical = canonicalizePath(tok, cwd);
      const reachesHoldout = isHoldoutPath(canonical) || dataDir != null && dataDir.length > 0 && tok.includes("holdouts") && tok.includes(dataDir);
      if (reachesHoldout) {
        const target = isHoldoutPath(canonical) ? canonical : tok;
        return deny(
          "holdout_read_denied",
          `Bash command referencing the holdout answer-key store ('${target}')${viaReader} is forbidden (\u0394 Y)`
        );
      }
    }
    return allow();
  }
  return allow();
}
async function runHoldoutGuard(_argv = [], deps = {}) {
  let input;
  try {
    const raw = deps.readRaw ? await deps.readRaw() : await readStdin();
    input = parseHookInput(raw);
  } catch {
    const decision2 = deny("malformed_hook_input", "holdout-guard: unparseable hook input");
    emitPermissionDecision(decision2);
    return EXIT.ERROR;
  }
  const decision = decideHoldoutGuard(input, deps);
  emitPermissionDecision(decision);
  return decisionToExitCode(decision);
}

// src/hooks/secret-guard.ts
var ENV_COMMITTABLE = /^\.env\.(example|sample|template|test)$/;
var PATH_BLOCKLIST = [
  /^\.env$/,
  /^\.env\..+$/,
  /\.pem$/,
  /\.key$/,
  /^id_(rsa|ed25519|ecdsa|dsa)/,
  /^credentials\.(json|ya?ml)$/,
  /\.(keystore|p12|pfx|jks)$/,
  /^service-account.*\.json$/,
  /^\.netrc$/,
  /\.crt$/,
  /\.(tfvars|tfstate)$/,
  /^kubeconfig$/,
  /^firebase-adminsdk-.*\.json$/,
  /\.kdbx$/,
  /^wrangler\.toml$/,
  /\.(gpg|asc|ppk)$/
];
function findGitCommitOrPush(command) {
  for (const seg of command.split(SEGMENT_SPLIT_RE)) {
    const inv = parseGitInvocation(seg);
    if (inv.subcommand === "commit") {
      return { isCommit: true, inv };
    }
    if (inv.subcommand === "push") {
      return { isCommit: false, inv };
    }
    const tokens = seg.split(/\s+/).filter((t) => t.length > 0);
    const gitAt = tokens.findIndex((t) => (t.split("/").pop() ?? t) === "git");
    if (gitAt >= 0) {
      const rest = tokens.slice(gitAt + 1);
      if (rest.includes("commit")) {
        return { isCommit: true, inv };
      }
      if (rest.includes("push")) {
        return { isCommit: false, inv };
      }
    }
  }
  return null;
}
var GIT_DIR_FLAG_RE = /(^|\s)--git-dir(=|\s)/;
var WORK_TREE_FLAG_RE = /(^|\s)--work-tree(=|\s)/;
var REDIRECT_ENV = /* @__PURE__ */ new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE"
]);
async function execOrDeny(execFn, cwd, argvs, reason, msg) {
  const results = [];
  try {
    for (const argv of argvs) {
      results.push(await execFn("git", ["-C", cwd, ...argv], {}));
    }
  } catch {
    return deny(reason, msg);
  }
  if (results.some((r) => r.code !== 0)) {
    return deny(reason, msg);
  }
  return results;
}
async function decideSecretGuard(input, deps = {}) {
  const command = commandOf(input);
  if (command.length === 0) {
    return allow();
  }
  const cwd = deps.cwd ?? process.cwd();
  const autonomousMode = deps.autonomousMode ?? process.env.FACTORY_AUTONOMOUS_MODE === "1";
  const execFn = deps.exec ?? exec;
  if (autonomousMode && isNestedShellOrHookBypass(command)) {
    return deny("nested_shell_denied", `nested-shell or hook-bypass not allowed in autonomous mode: ${command}`);
  }
  const match = findGitCommitOrPush(command);
  if (!match) {
    return allow();
  }
  const { isCommit, inv } = match;
  if (GIT_DIR_FLAG_RE.test(command) || WORK_TREE_FLAG_RE.test(command)) {
    return deny("git_dir_override_denied", `git-dir/work-tree override blocked: ${command}`);
  }
  const redirectEnv = parseGitInvocation(command).envNames.filter((name) => REDIRECT_ENV.has(name));
  if (redirectEnv.length > 0) {
    return deny(
      "git_redirect_env_denied",
      `git index/repo-redirecting env override blocked (${redirectEnv.join(", ")}): ${command}`
    );
  }
  const commitDir = inv.workDir.length > 0 ? inv.workDir : cwd;
  const repo = await execOrDeny(
    execFn,
    commitDir,
    [["rev-parse", "--git-dir"]],
    "non_git_target",
    `secret-commit-guard: cannot scan, '${commitDir}' is not a git repository`
  );
  if (!Array.isArray(repo)) {
    return repo;
  }
  let scanPaths = "";
  let scanDiff = "";
  if (isCommit) {
    const res = await execOrDeny(
      execFn,
      commitDir,
      [
        ["diff", "--cached", "--name-only"],
        ["diff", "--cached", "-U0"]
      ],
      "git_diff_failed",
      "secret-commit-guard: git diff failed \u2014 cannot verify staged changes"
    );
    if (!Array.isArray(res)) {
      return res;
    }
    scanPaths = at(res, 0).stdout;
    scanDiff = at(res, 1).stdout;
  } else {
    const logFailed = "secret-commit-guard: git log failed \u2014 cannot verify pushed commits";
    let res = await execOrDeny(
      execFn,
      commitDir,
      [
        ["log", "@{upstream}..HEAD", "--name-only", "--format="],
        ["log", "-p", "@{upstream}..HEAD", "-U0"]
      ],
      "git_log_failed",
      logFailed
    );
    if (!Array.isArray(res)) {
      res = await execOrDeny(
        execFn,
        commitDir,
        [
          ["log", "HEAD", "--name-only", "--format="],
          ["log", "-p", "HEAD", "-U0"]
        ],
        "git_log_failed",
        logFailed
      );
      if (!Array.isArray(res)) {
        return res;
      }
    }
    scanPaths = at(res, 0).stdout;
    scanDiff = at(res, 1).stdout;
  }
  const blocks = [];
  for (const raw of scanPaths.split("\n")) {
    const fpath = raw.trim();
    if (fpath.length === 0) {
      continue;
    }
    const base = fpath.split("/").pop() ?? fpath;
    if (ENV_COMMITTABLE.test(base)) {
      continue;
    }
    for (const glob of PATH_BLOCKLIST) {
      if (glob.test(base) || glob.test(fpath)) {
        blocks.push(`path:${fpath}`);
        break;
      }
    }
  }
  if (scanDiff.length > 0) {
    const hits = detectSecrets(scanDiff);
    for (const name of hits) {
      blocks.push(`content:${name}`);
    }
  }
  if (blocks.length > 0) {
    return deny("secret_detected", blocks.join(", "));
  }
  return allow();
}
async function runSecretGuard(_argv = [], deps = {}) {
  let input;
  try {
    const raw = deps.readRaw ? await deps.readRaw() : await readStdin();
    input = parseHookInput(raw);
  } catch {
    const decision2 = deny("malformed_hook_input", "secret-guard: unparseable hook input");
    emitPermissionDecision(decision2);
    return EXIT.ERROR;
  }
  const decision = await decideSecretGuard(input, deps);
  emitPermissionDecision(decision);
  return decisionToExitCode(decision);
}

// src/hooks/pipeline-guards.ts
import { join as join5 } from "node:path";

// src/verifier/deterministic/scope.ts
function isTestPath(file) {
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs)$/.test(file)) {
    return true;
  }
  if (/_test\.(go|py|rb|exs)$/.test(file)) {
    return true;
  }
  if (/Test\.(java|kt|php)$/.test(file)) {
    return true;
  }
  if (/Tests\.(swift|cs)$/.test(file)) {
    return true;
  }
  if (file.endsWith("_spec.rb")) {
    return true;
  }
  if (/^(tests|test|spec|__tests__)\//.test(file)) {
    return true;
  }
  if (/\/(tests|test|spec|__tests__)\//.test(file)) {
    return true;
  }
  return false;
}

// src/types/phases-vocab.ts
var TASK_PHASES = ["preflight", "tests", "exec", "verify", "ship"];
var SPAWN_PHASES = ["tests", "exec", "verify"];

// src/core/state/schema.ts
var RunStatusEnum = external_exports.enum(["running", "completed", "superseded", "paused", "suspended", "failed"]);
var TERMINAL_RUN_STATUSES = ["completed", "failed", "superseded"];
function isTerminalRunStatus(s) {
  return TERMINAL_RUN_STATUSES.includes(s);
}
var TaskStatusEnum = external_exports.enum(["pending", "executing", "reviewing", "shipping", "done", "failed"]);
var TERMINAL_TASK_STATUSES = ["done", "failed"];
function isTerminalTaskStatus(s) {
  return TERMINAL_TASK_STATUSES.includes(s);
}
var FailureClassEnum = external_exports.enum([
  "capability-budget",
  "spec-defect",
  "blocked-environmental",
  "needs-context",
  "blocked-dependency"
]);
var RiskTierEnum = external_exports.enum(["low", "medium", "high"]);
var EscalationRungSchema = external_exports.number().int().min(0);
var PanelVerdictEnum = external_exports.enum(["approve", "blocked", "error"]);
var ProducerRoleEnum = external_exports.enum(["test-writer", "implementer"]);
var SpecPointerSchema = external_exports.object({
  /** Repo identity, e.g. "owner/name". The first key of (repo, spec-id). */
  repo: external_exports.string().min(1),
  /** `<issue>-<slug>`. The second key of (repo, spec-id). */
  spec_id: external_exports.string().min(1),
  /** The PRD issue number — the STABLE lookup key embedded in spec_id. */
  issue_number: external_exports.number().int().positive()
});
var ReviewerResultSchema = external_exports.object({
  /** Reviewer identity (e.g. "implementation", "security", "silent-failure"). */
  reviewer: external_exports.string().min(1),
  /** This reviewer's verdict after verify-then-fix adjudication. */
  verdict: PanelVerdictEnum,
  /** Pointer to the review artifact (relative to the run's reviews/ dir). */
  artifact: external_exports.string().optional(),
  /** Number of confirmed (verified) blocking findings this reviewer raised. */
  confirmed_blockers: external_exports.number().int().min(0).default(0)
});
var FixFindingSchema = external_exports.object({
  /** Origin of the finding: a reviewer name (e.g. "security") or a gate id (e.g. "lint"). */
  reviewer: external_exports.string().min(1),
  file: external_exports.string().optional(),
  line: external_exports.number().int().positive().optional(),
  description: external_exports.string().min(1)
}).superRefine((finding, ctx) => {
  const hasFile = finding.file !== void 0;
  const hasLine = finding.line !== void 0;
  if (hasFile && !hasLine) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["line"],
      message: `finding has 'file' but no 'line' \u2014 provide both or neither for a citable finding`
    });
  }
  if (hasLine && !hasFile) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["file"],
      message: `finding has 'line' but no 'file' \u2014 provide both or neither for a citable finding`
    });
  }
});
var ReviewDispositionSchema = external_exports.object({
  /** Which reviewer raised the original finding. */
  reviewer: external_exports.string().min(1),
  /** Why it does not gate: verifier-refuted, or raised non-blocking. */
  disposition: external_exports.enum(["refuted", "non-blocking"]),
  file: external_exports.string().optional(),
  line: external_exports.number().int().positive().optional(),
  /** The verbatim quote from the original finding (fingerprint half 1). */
  quote: external_exports.string().min(1),
  /** The one-sentence claim from the original finding (fingerprint half 2). */
  claim: external_exports.string().min(1),
  /** The refutation reason (refuted entries only). */
  note: external_exports.string().optional(),
  /** The verify round (attempt) that adjudicated it. */
  round: external_exports.number().int().positive()
});
var TaskStateSchema = external_exports.object({
  task_id: external_exports.string().min(1),
  status: TaskStatusEnum.default("pending"),
  /**
   * Task ids this task depends on (the vertical-slice DAG, Decision 23). A
   * deliberate denormalization: copied from the {@link SpecTask} at seed time and
   * then frozen (never mutated), so the hot DAG-traversal readers — `next.ts`
   * (ready-task selection) and `rescue/scan.ts` (drift scan, which has NO spec in
   * scope) — read edges straight off run state without coupling to the spec store.
   * Integrity is pinned at seed time by `seedTasksFromSpec`, where dangling, self,
   * cyclic, and duplicate edges all fail LOUD.
   */
  depends_on: external_exports.array(external_exports.string()).default([]),
  // --- Producer ladder (Decision 25; the risk_tier dial lives on the SpecTask, not here) ---
  /** Current rung on the producer escalation ladder (0 = starting rung). */
  escalation_rung: EscalationRungSchema.default(0),
  /** Which producer role is/last ran. */
  producer_role: ProducerRoleEnum.optional(),
  /**
   * Defect feedback carried from the implementer's `test-defective` escalation into
   * the NEXT test-writer re-run (the test-revision recovery, Δ D). Set when the
   * implementer reports the RED test is wrong; injected into the regenerated
   * test-writer's prior-failure context (handlers.tests) so it does not re-pin the
   * same wrong literal; cleared once the test-writer returns `done`. Absent
   * otherwise. Transient — not a failure field (allowed on any status).
   */
  test_revision_feedback: external_exports.string().optional(),
  /**
   * The producer's open NEEDS_CONTEXT question (Decision 69). Written on the
   * first NEEDS_CONTEXT at a phase (the task re-spawns ONCE at the same rung with
   * the question injected); a second consecutive NEEDS_CONTEXT fails the task
   * `needs-context` with the question refreshed. `answer` is written only by
   * `rescue apply --answer` and is injected alongside the question on the
   * post-reset re-spawn. Cleared when a producer returns `done` (any role — a
   * completed attempt resolves the question by construction). Deliberately
   * PRESERVED by rescue's resetTaskRow (unlike most transients): the open
   * question is the whole point of the reset. Transient — allowed on any status.
   */
  needs_context: external_exports.object({
    question: external_exports.string().min(1),
    answer: external_exports.string().min(1).optional()
  }).optional(),
  /**
   * The failing gate-id set of the LAST blocked merge-gate verify (sorted,
   * holdout excluded — Decision 71). An event record like `fix_findings`
   * (the reviewers it derives from are cleared by escalateOrFail). When the next
   * blocked verify fails the IDENTICAL set, the escalation is routed to the
   * `tests` phase (the RED test is suspected as the broken arbiter) instead of
   * re-rolling the implementer. Cleared on the advancing verify write, on
   * doneTaskRow, and by rescue's resetTaskRow. Transient — allowed on any status.
   */
  last_failing_gates: external_exports.array(external_exports.string().min(1)).optional(),
  /**
   * Feedback carried from a failing e2e journey spec into this task's NEXT
   * implementation pass (the e2e reopen loop, Decision 39). Set by the e2e coroutine
   * when it maps a failing spec to this task via the author manifest and resets the
   * task to `pending`; injected into the regenerated producer's prior-failure context
   * (mirrors `test_revision_feedback`, but originates from a RUN-LEVEL phase, not a
   * per-task producer outcome). Cleared once the task ships again. Absent otherwise.
   * Transient — not a failure field (allowed on any status).
   */
  e2e_feedback: external_exports.string().optional(),
  /**
   * Fix-forward instructions carried from a blocked merge-gate verify into the
   * NEXT producer (`exec`) rung (D5 fix-forward channel). Composed at the
   * wait-retry branch (`record.ts`) from confirmed reviewer blockers ∪ non-holdout
   * failing gate evidence, persisted BEFORE `escalateOrFail` clears `reviewers`
   * (mirrors the `test_revision_feedback` precedent: a separate write ahead of the
   * ladder transition). `handlers.ts`'s `exec` reads it into `buildProducerContext`
   * as `confirmedBlockers`. Cleared on the next advance/complete. Absent otherwise.
   * Transient — not a failure field (allowed on any status).
   */
  fix_findings: external_exports.array(FixFindingSchema).optional(),
  /**
   * Anti-ratcheting disposition ledger (Decision 68): claims a prior verify round
   * refuted or raised non-blocking, appended at the wait-retry branch (record.ts,
   * same separate-write pattern as `fix_findings`) and injected into the NEXT
   * round's panel reviewer prompts so a fresh-context reviewer cannot blindly
   * re-raise an already-dismissed claim. Survives `escalateOrFail`'s `{...t}`
   * spread across rung bumps; cleared when the task ships (doneTaskRow) and on
   * the advancing verify write. Transient — allowed on any status.
   */
  review_dispositions: external_exports.array(ReviewDispositionSchema).optional(),
  // --- Merge gate (Decision 26/27) ---
  /** Per-reviewer panel results (derive.ts computes the merge-gate verdict from these). */
  reviewers: external_exports.array(ReviewerResultSchema).default([]),
  /**
   * Δ U/S5 — set IFF the ADVANCING verify pass ran WITHOUT an independent
   * cross-vendor reviewer (runPanel's crossVendorAbsence). An EVENT RECORD like
   * `reviewers[]` (derive-don't-store exception: which executor actually reviewed
   * is not derivable after the fact). Written/cleared in the SAME advance write
   * as `reviewers`; surfaced by the partial report + run summary.
   */
  cross_vendor_absent: external_exports.object({ reason: external_exports.string().min(1) }).optional(),
  // --- Git / PR pointers (WS3 populates; schema reserves the shape) ---
  /** Run-scoped branch `factory/<run_id>/<task_id>` (Δ M). */
  branch: external_exports.string().optional(),
  /** PR number once created (idempotent-create keyed off branch, Δ P). */
  pr_number: external_exports.number().int().positive().optional(),
  // --- Failure classification (Decision 22, Δ D) ---
  /** Set IFF status === "failed": the closed-enum cause. */
  failure_class: FailureClassEnum.optional(),
  /** Human-facing reason string accompanying a fail. */
  failure_reason: external_exports.string().optional(),
  /**
   * The precise resume cursor for the drive orchestrator — which TaskPhase the task is
   * at/resuming at. Written by markInFlight. Lossy `status` stays the human-facing
   * summary; `phase` is the machine cursor. Absent = not started (preflight).
   * NOTE: on terminal rows (done/failed), `phase` is the last in-flight phase,
   * not a resume point — terminal writers do not clear it.
   * NOTE: both this enum and phase-machine's TASK_PHASE_ORDER import the SAME
   * literal tuple from `types/phases-vocab.ts` (the dependency-free vocabulary
   * leaf), so they cannot drift; the cross-check test in
   * src/orchestrator/orchestrator.test.ts is belt-and-braces, not load-bearing.
   */
  phase: external_exports.enum(TASK_PHASES).optional(),
  /** Ship live-merge re-sync count (cap enforced by the orchestrator; persisted so the cap survives process boundaries). */
  merge_resyncs: external_exports.number().int().min(0).default(0),
  /**
   * Same-rung verify re-runs consumed for holdout EVALUATOR failures (malformed
   * validator output — unparseable/wrong-cardinality/mismatched/blank-evidence-pass).
   * Distinct from `spawn_in_flight.redrives` (hung-spawn respawn, Decision 66): this
   * counts delivered-but-broken evaluator output. Cap enforced in record.ts
   * (HOLDOUT_EVALUATOR_RETRY_CAP); exhaustion fails the task `blocked-environmental`.
   * Absent = 0.
   */
  holdout_evaluator_retries: external_exports.number().int().min(0).optional(),
  /**
   * Spawn-in-flight checkpoint (idempotent re-spawn). Set by the orchestrator when it
   * EMITS a spawn for `phase` at `rung`, recording the task-branch `tip_sha` at emit
   * time. Producers commit to the SHARED task worktree, so a stop in the post-spawn /
   * pre-record window leaves the abandoned producer's partial commits on the branch. On
   * the resume that re-enters the SAME (phase, rung) before any results were recorded,
   * the orchestrator resets the worktree to `tip_sha` — discarding ONLY the interrupted
   * phase's work (prior completed phases live below it) — then re-spawns. A fresh
   * spawn overwrites it; terminal writers (complete/fail) clear it. Absent = no spawn
   * in flight (the steady state between phases).
   *
   * `phase` is the spawn-phase subset (tests|exec|verify) — preflight/ship never spawn.
   * Both this enum and orchestrator/results' SPAWN_PHASES import the same tuple from
   * `types/phases-vocab.ts`, so they cannot drift (the orchestrator.test.ts cross-check
   * is belt-and-braces, mirroring the `phase` field's pin).
   */
  spawn_in_flight: external_exports.object({
    phase: external_exports.enum(SPAWN_PHASES),
    rung: external_exports.number().int().min(0),
    tip_sha: external_exports.string().min(1),
    /** Epoch SECONDS (the shared quota clock, `OrchestratorDeps.now()`) at
     * spawn emit; refreshed on a matching re-entry. Stall-TTL detection
     * (`next.ts` `work.stale`/`work.hung`) reads this — advisory only, no
     * status change. Defaults to 0 (epoch) so a pre-S? checkpoint persisted
     * before this field existed parses as maximally aged — it lands in `hung`
     * (kill + re-drive) — correct: an untimed in-flight spawn should be
     * flagged for re-drive, not silently trusted. */
    spawned_at: external_exports.number().default(0),
    /**
     * Matching (phase, rung) re-entries already consumed — the bound on the
     * kill→respawn→hang loop (Decision 66). Incremented by the orchestrator's
     * re-entry branch; a fresh checkpoint (any phase/rung advance) is written
     * with 0, so the budget is per-(phase, rung) by construction. Defaults to
     * 0 so a checkpoint persisted before this field existed parses with a
     * FULL budget — safe: the cap bounds FUTURE re-entries only (the opposite
     * gotcha from spawned_at, whose default-0 must read as maximally aged).
     */
    redrives: external_exports.number().int().min(0).default(0)
  }).optional(),
  // --- Lifecycle timestamps (ISO-8601) ---
  started_at: external_exports.string().optional(),
  ended_at: external_exports.string().optional()
});
function refineTaskCrossFields(task, ctx) {
  const isFailed = task.status === "failed";
  if (isFailed && task.failure_class == null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["failure_class"],
      message: `task '${task.task_id}' is 'failed' but has no failure_class (a fail must be classified)`
    });
  }
  if (!isFailed && task.failure_class != null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["failure_class"],
      message: `task '${task.task_id}' has failure_class '${task.failure_class}' but status is '${task.status}' (failure_class is set IFF failed)`
    });
  }
  const hasReason = task.failure_reason != null && task.failure_reason.length > 0;
  if (isFailed && !hasReason) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["failure_reason"],
      message: `task '${task.task_id}' is 'failed' but has no failure_reason (a fail must carry a human-facing reason)`
    });
  }
  if (!isFailed && task.failure_reason != null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["failure_reason"],
      message: `task '${task.task_id}' has a failure_reason but status is '${task.status}' (failure_reason is set IFF failed)`
    });
  }
  task.reviewers.forEach((r, i) => {
    if (r.verdict === "approve" && r.confirmed_blockers !== 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["reviewers", i, "confirmed_blockers"],
        message: `reviewer '${r.reviewer}' approves but records ${r.confirmed_blockers} confirmed blocker(s) (approve \u21D2 0)`
      });
    }
    if (r.verdict === "blocked" && r.confirmed_blockers === 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["reviewers", i, "confirmed_blockers"],
        message: `reviewer '${r.reviewer}' is blocked but records 0 confirmed blockers (blocked \u21D2 \u22651)`
      });
    }
  });
  const inFlight = task.status === "executing" || task.status === "reviewing" || task.status === "shipping";
  if (inFlight && task.phase === void 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["phase"],
      message: `task '${task.task_id}' has in-flight status '${task.status}' but no phase cursor \u2014 phase is written in lockstep with status (state from an older factory version); start a fresh run`
    });
  }
  if (task.spawn_in_flight !== void 0 && task.spawn_in_flight.rung > task.escalation_rung) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["spawn_in_flight", "rung"],
      message: `task '${task.task_id}' spawn_in_flight.rung (${task.spawn_in_flight.rung}) > escalation_rung (${task.escalation_rung}) \u2014 rung went backward, stale checkpoint from before a rescue reset`
    });
  }
}
var TaskStateChecked = TaskStateSchema.superRefine(refineTaskCrossFields);
var QuotaCheckpointSchema = external_exports.discriminatedUnion("binding_window", [
  external_exports.object({ binding_window: external_exports.literal("5h"), resets_at_epoch: external_exports.number().int().nonnegative() }),
  external_exports.object({ binding_window: external_exports.literal("7d"), resets_at_epoch: external_exports.number().int().nonnegative() }),
  external_exports.object({ binding_window: external_exports.literal("unavailable") })
]);
function concludedPhaseMarker(afterReason, afterAttempts) {
  return external_exports.object({
    status: external_exports.enum(["done", "failed"]),
    reason: external_exports.string().optional(),
    ...afterReason,
    attempts: external_exports.number().int().nonnegative().optional(),
    ...afterAttempts,
    ended_at: external_exports.string()
  });
}
function openPhaseMarker(afterReason, afterAttempts) {
  return external_exports.object({
    status: external_exports.enum(["done", "failed"]).optional(),
    reason: external_exports.string().optional(),
    ...afterReason,
    attempts: external_exports.number().int().nonnegative().optional(),
    ...afterAttempts,
    ended_at: external_exports.string().optional()
  });
}
var DocsPhaseSchema = concludedPhaseMarker({}, {});
var TraceabilityVerdictRowSchema = external_exports.object({
  requirement: external_exports.string().min(1),
  verdict: external_exports.enum(["met", "partial", "unmet"]),
  evidence: external_exports.string().min(1)
});
var TraceabilityPhaseSchema = concludedPhaseMarker(
  {},
  {
    /** One row per PRD requirement; empty ⇔ no parseable audit ever landed. */
    verdicts: external_exports.array(TraceabilityVerdictRowSchema).default([])
  }
);
var E2eSpecKindEnum = external_exports.enum(["critical", "throwaway"]);
var E2eManifestEntrySchema = external_exports.object({
  /** Task id(s) this spec exercises (a critical journey spec may span >1 task). */
  task_ids: external_exports.array(external_exports.string().min(1)).min(1),
  /** Spec file path — repo-relative for `critical`, run-ephemeral-dir-relative for `throwaway`. */
  spec_path: external_exports.string().min(1),
  kind: E2eSpecKindEnum,
  /**
   * Human-readable journey name (Decision 40 D12) — surfaces in the run report's
   * "journeys covered" section so a zero-e2e-knowledge operator can read what was
   * proven. Optional: pre-D12 manifests lack it (renderer falls back to spec_path).
   */
  title: external_exports.string().min(1).optional()
});
var E2eAdjudicationSpecSchema = external_exports.object({
  /** Repo-relative path of the failing committed spec. */
  spec_path: external_exports.string().min(1),
  /** The failing spec's human-readable title (from the Playwright results). */
  title: external_exports.string(),
  /** The failing assertion/step detail (D8), threaded into the adjudicator prompt. */
  error: external_exports.string().optional(),
  mode: external_exports.enum(["adjudicate", "update"])
});
var E2eAdjudicationSchema = external_exports.object({
  specs: external_exports.array(E2eAdjudicationSpecSchema).min(1),
  /** Adjudicator SPAWN attempts (crash retry, mirrors `author_attempts`). */
  attempts: external_exports.number().int().nonnegative(),
  requested_at: external_exports.string()
});
var E2ePhaseSchema = openPhaseMarker(
  {
    /**
     * Non-gating note surfaced on a `done` phase — e.g. residual THROWAWAY red that
     * didn't block completion (Decision 39: only critical red gates). Distinct from
     * `reason`, which the T2 cross-field check reserves for `failed` (set IFF
     * failed) — `advisory` is the `done`-side counterpart, never present on `failed`.
     */
    advisory: external_exports.string().optional()
  },
  {
    /**
     * Author SPAWN attempts (Decision 40 D5): a crashed/unparseable author earns ONE
     * automatic re-spawn before the phase fails; distinct from `attempts` (suite
     * passes). Deliberate blocked-escalate/needs-context verdicts never retry.
     */
    author_attempts: external_exports.number().int().nonnegative().optional(),
    /** The author's spec→task manifest, fixed once authored and reused across passes. */
    manifest: external_exports.array(E2eManifestEntrySchema).default([]),
    /** Per-task reopen count so far, keyed by task_id — bounds each task by `e2e.reopenCap`. */
    reopen_counts: external_exports.record(external_exports.string(), external_exports.number().int().nonnegative()).default({}),
    /** In-flight adjudication cursor (D7) — see {@link E2eAdjudicationSchema}. */
    adjudication: E2eAdjudicationSchema.optional(),
    /**
     * Per-spec adjudication count, keyed by spec_path (D7 cap: 1 per spec per run).
     * A spec failing AGAIN after its one adjudication is a regression — the run
     * fails rather than adjudicating in a loop. Survives rescue's reset (like
     * `reopen_counts`): the cap holds across the whole run.
     */
    adjudication_counts: external_exports.record(external_exports.string(), external_exports.number().int().nonnegative()).optional()
  }
);
var E2eAffectedSpecSchema = external_exports.object({
  /** Repo-relative path of the existing committed spec. */
  spec_path: external_exports.string().min(1),
  /** Task id(s) in THIS run whose work touches the spec's journey. */
  task_ids: external_exports.array(external_exports.string().min(1)).min(1),
  expectation: external_exports.enum(["needs-update", "should-still-pass"])
});
var E2eAssessmentSchema = openPhaseMarker(
  {
    /** Degraded-coverage note on a `done` assessment (e.g. logged-out coverage only). */
    warning: external_exports.string().optional(),
    /** Boot config the assessor resolved + wrote into `playwright.config.ts` (D10). */
    resolved: external_exports.object({
      start_command: external_exports.string().min(1).optional(),
      base_url: external_exports.string().min(1).optional()
    }).optional(),
    /** Coverage forecast over EXISTING committed specs (empty when none exist). */
    affected_specs: external_exports.array(E2eAffectedSpecSchema).default([])
  },
  {}
);
var ExecutionModeEnum = external_exports.enum(["sequential", "balanced"]);
var ShipModeEnum = external_exports.enum(["no-merge", "live"]);
var MissSchema = external_exports.object({
  /** The task whose shipped code the miss traces to (∈ run.tasks — refined below). */
  task_id: external_exports.string().min(1),
  /** ISO-8601 record time, stamped by the CLI. */
  at: external_exports.string(),
  /** REQUIRED human description — a miss without one is noise. */
  note: external_exports.string().min(1),
  /**
   * Human judgment: which reviewer lens SHOULD have caught it (a panel role), or
   * 'none' when no lens could have. Stays a bare string here — a frozen state schema
   * must not import the verifier's panel roster; the `factory miss` CLI validates
   * it against `panelRolesFor(true) ∪ {'none'}`.
   */
  lens: external_exports.string().min(1).optional()
});
var RunStateSchema = external_exports.object({
  /** State-schema version (independent of plugin version). */
  schema_version: external_exports.literal(3).default(3),
  /** `run-YYYYMMDD-HHMMSS`. */
  run_id: external_exports.string().min(1),
  status: RunStatusEnum.default("running"),
  execution_mode: ExecutionModeEnum.default("sequential"),
  ship_mode: ShipModeEnum.default("live"),
  /**
   * The Claude Code session id that OWNS this run. MANDATORY at `run create` —
   * resolution (`--session-id` flag, else `CLAUDE_CODE_SESSION_ID`) failing is a
   * UsageError, so every new run is owned. The schema keeps the field optional
   * only for legacy persisted runs created before the requirement. The Stop hook
   * uses it to scope a resumability HINT to the owning session (`findActiveByOwner`
   * never matches an ownerless run) — it never blocks, and there is no unscoped
   * fallback (see hooks/stop-gate.ts). An immutable property, never a derived verdict.
   */
  owner_session: external_exports.string().min(1).optional(),
  /**
   * The per-run staging branch this run cut + pushed (`staging-<run-id>`). PINNED
   * ONCE at `run create` (Decision 33) so every later base-ref resolution — worktree
   * fork point, deterministic-gate diff base, reviewer/holdout inspect ref, ship
   * merge target, rollup source — reads the branch the run ACTUALLY created, not a
   * value recomputed by `runStagingBranch(run_id)`. A mid-run naming-scheme change
   * (e.g. the slashed→flat rename) would otherwise silently desync the recompute from
   * the already-pushed branch. Git provenance / immutable identity — NOT a derived
   * verdict, so derive-don't-store does not apply.
   */
  staging_branch: external_exports.string().min(1),
  /** Pointer to the durable spec (Δ X) — NOT an embedded spec. */
  spec: SpecPointerSchema,
  /** Per-task state, keyed by task_id (cross-field checks applied per task). */
  tasks: external_exports.record(external_exports.string(), TaskStateChecked).default({}),
  /**
   * When true, the quota gate skips pacing and returns null unconditionally. Set once at
   * `run create` from `--ignore-quota`, or toggled true by `factory resume --ignore-quota`.
   * Persisted so both orchestrators skip the gate without per-call flag threading.
   * Default false: legacy runs (no field) are unaffected.
   */
  ignore_quota: external_exports.boolean().default(false),
  /** Quota resume checkpoint (Decision 24); absent until a pause/suspend. */
  quota: QuotaCheckpointSchema.optional(),
  /**
   * Bounded auto-rescue ledger (S10, Decision 48). Stamped INSIDE the same locked
   * `applyRescue` mutation that performs an `--auto` reset. A sanctioned
   * stored-EVENT exception to derive-don't-store (precedent: the retired
   * `paused_minutes`): "how many self-heal cycles already ran" is history no
   * state/git re-derivation can recover. `factory rescue auto` requires
   * `attempts < SELF_HEAL_MAX_ATTEMPTS`, bounding the self-heal loop to ≤3
   * cycles per run (Decision 60; each failed finalize spends one).
   */
  self_heal: external_exports.object({
    attempts: external_exports.number().int().nonnegative(),
    last_at: external_exports.string()
  }).optional(),
  /**
   * Human-intervention ledger (S11): one entry per human action on the run —
   * `launch` (run create), `conflict` (a `--supersede` resolution, stamped on the
   * NEW run alongside its launch), `resume` (a human resume clearing a park),
   * `recover` (an approved rescue apply that did work). The second sanctioned
   * stored-EVENT exception (with `self_heal`): which touches happened is history
   * nothing can re-derive. `--auto` self-heal NEVER appends — it is not a human.
   * The touch METRIC stays derived: `(completed ? 1 : 0) / touches.length`,
   * guarded to n/a on an empty ledger — never a fabricated number.
   */
  human_touches: external_exports.array(
    external_exports.object({
      kind: external_exports.enum(["launch", "conflict", "resume", "recover"]),
      at: external_exports.string()
    })
  ).default([]),
  /**
   * review-miss ledger (Decision 61): one entry per human-reported defect in
   * shipped factory-produced code, post-merge. The THIRD sanctioned stored-EVENT
   * exception to derive-don't-store (with `self_heal` + `human_touches`) — "a human
   * found this in shipped code" is history nothing can re-derive. Appended by
   * `factory miss`; `factory score` derives the miss metrics from it. Default []:
   * legacy runs (no field) carry no misses.
   */
  misses: external_exports.array(MissSchema).default([]),
  /** Documentation phase marker; absent until the docs phase runs (engine docs phase). */
  docs: DocsPhaseSchema.optional(),
  /** PRD-traceability phase marker (S9); absent until the phase runs. */
  traceability: TraceabilityPhaseSchema.optional(),
  /**
   * Whether this run opted into the e2e phase (the `--e2e` flag). Set once at
   * `run create`; immutable for the run's lifetime — mirrors `ignore_quota`.
   * Default false: a run without the flag never gates on `wantsE2e()`.
   */
  e2e: external_exports.boolean().default(false),
  /** E2E phase marker + author manifest; absent until the e2e phase first runs. */
  e2e_phase: E2ePhaseSchema.optional(),
  /** Run-start e2e assessment record (Decision 40 D3); absent until it first spawns. */
  e2e_assessment: E2eAssessmentSchema.optional(),
  /**
   * The `completed` run's staging→develop rollup outcome, persisted at finalize
   * ONLY when it did not land (`merged:false`). Two shapes: (a) an armed-but-not-
   * landed rollup PR (`number` present — e.g. the "auto-armed" branch-policy
   * fallback, D3; the run went terminal at step 7); (b) a forward-reconcile merge
   * CONFLICT before any rollup PR exists (`number` absent; finalize threw, run
   * stays NON-terminal). Absent on a merged rollup (nothing to recover) or a
   * `failed` run (no rollup attempted). Lets `rescue scan` flag either case
   * (`rollup_pending`) without a live GitHub call. Recovery: (a) `rescue apply
   * --recheck-rollup` reopens the run so a re-drive re-enters `finalizeRun`,
   * whose rollup() resume-guard finds the now-merged PR; (b) human resolves the
   * staging↔develop conflict, then plain `factory resume` re-enters finalize,
   * which overwrites/clears this marker with the real rollup result.
   */
  rollup: external_exports.object({
    /** Rollup PR number; absent when the block precedes PR creation (reconcile conflict). */
    number: external_exports.number().int().positive().optional(),
    merged: external_exports.boolean(),
    reason: external_exports.string().optional()
  }).optional(),
  /**
   * Whether this run is a `/factory:debug` session. Set once at `run create`;
   * immutable for the run's lifetime — mirrors `e2e`/`ignore_quota`. A `debug:true`
   * run loops through multiple review⇄fix passes before finalizing, so it defers
   * `run finalize` (the PRD comment/close) to the debug driver instead of the plain
   * runner loop, and the Stop gate skips even its resumability hint for it. Default
   * false: a run without the flag finalizes exactly as before.
   */
  debug: external_exports.boolean().default(false),
  /**
   * WHY the run went terminal as `failed`/`superseded` — a one-line human-facing
   * cause (evaluator exhaustion, e2e phase failure, operator cancel, superseding
   * run id, …). Written ONLY by `StateManager.finalize`, which REQUIRES it for
   * failed/superseded and FORBIDS it for completed; the schema keeps it optional
   * so legacy terminal states (written before the field existed) still parse —
   * they display "reason unavailable". A stored terminal EVENT, not a derived
   * verdict: the cause at flip time is history nothing can re-derive.
   */
  terminal_reason: external_exports.string().min(1).optional(),
  /** Lifecycle timestamps (ISO-8601). */
  started_at: external_exports.string(),
  updated_at: external_exports.string(),
  ended_at: external_exports.string().nullable().default(null)
});
function reasonIffFailed(ctx, opts) {
  const isFailed = opts.status === "failed";
  const hasReason = opts.reason != null && opts.reason.length > 0;
  if (isFailed && !hasReason) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: [...opts.path],
      message: `run '${opts.runId}' ${opts.label} is 'failed' but has no reason`
    });
  }
  if (!isFailed && hasReason) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: [...opts.path],
      message: `run '${opts.runId}' ${opts.label} is '${opts.status}' but carries a reason (reason is set IFF failed)`
    });
  }
}
function refineRunCrossFields(run, ctx) {
  if (run.quota != null) {
    const wanted = run.quota.binding_window === "5h" ? "paused" : "suspended";
    if (run.status !== wanted) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["quota"],
        message: `run '${run.run_id}' carries a '${run.quota.binding_window}' quota checkpoint but status is '${run.status}' (a '${run.quota.binding_window}' checkpoint pairs with '${wanted}')`
      });
    }
  }
  if (isTerminalRunStatus(run.status) !== (run.ended_at != null)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["ended_at"],
      message: isTerminalRunStatus(run.status) ? `run '${run.run_id}' is terminal ('${run.status}') but has no ended_at` : `run '${run.run_id}' is '${run.status}' (non-terminal) but carries ended_at`
    });
  }
  if (run.terminal_reason !== void 0 && run.status !== "failed" && run.status !== "superseded") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["terminal_reason"],
      message: `run '${run.run_id}' is '${run.status}' but carries terminal_reason (only failed|superseded may)`
    });
  }
  if (run.docs !== void 0) {
    reasonIffFailed(ctx, {
      runId: run.run_id,
      path: ["docs", "reason"],
      label: "docs phase",
      status: run.docs.status,
      reason: run.docs.reason
    });
  }
  if (run.traceability !== void 0) {
    reasonIffFailed(ctx, {
      runId: run.run_id,
      path: ["traceability", "reason"],
      label: "traceability phase",
      status: run.traceability.status,
      reason: run.traceability.reason
    });
    if (run.traceability.status === "done" && run.traceability.verdicts.some((v) => v.verdict === "unmet")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["traceability", "verdicts"],
        message: `run '${run.run_id}' traceability phase is 'done' but carries an 'unmet' verdict (unmet must record as failed)`
      });
    }
  }
  if (run.e2e_phase?.status !== void 0) {
    const isFailed = run.e2e_phase.status === "failed";
    reasonIffFailed(ctx, {
      runId: run.run_id,
      path: ["e2e_phase", "reason"],
      label: "e2e phase",
      status: run.e2e_phase.status,
      reason: run.e2e_phase.reason
    });
    const hasAdvisory = run.e2e_phase.advisory != null && run.e2e_phase.advisory.length > 0;
    if (isFailed && hasAdvisory) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["e2e_phase", "advisory"],
        message: `run '${run.run_id}' e2e phase is 'failed' but carries an advisory (advisory is the done-side counterpart of reason, never set on failed)`
      });
    }
  }
  if (run.e2e_assessment?.status !== void 0) {
    reasonIffFailed(ctx, {
      runId: run.run_id,
      path: ["e2e_assessment", "reason"],
      label: "e2e assessment",
      status: run.e2e_assessment.status,
      reason: run.e2e_assessment.reason
    });
  }
  for (const [k, value] of Object.entries(run.tasks)) {
    if (k !== value.task_id) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["tasks", k, "task_id"],
        message: `tasks map key '${k}' does not match row task_id '${value.task_id}'`
      });
    }
  }
  run.misses.forEach((e, i) => {
    if (run.tasks[e.task_id] === void 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["misses", i, "task_id"],
        message: `miss-ledger references task '${e.task_id}' which is not in run '${run.run_id}'`
      });
    }
  });
}
var RunStateChecked = RunStateSchema.superRefine(refineRunCrossFields);
function parseRunState(raw) {
  return RunStateChecked.parse(raw);
}

// src/core/state/manager.ts
import { mkdir as mkdir3, readFile, readdir, readlink, rename as rename2, rm, symlink, unlink as unlink2 } from "node:fs/promises";
import { existsSync as existsSync4 } from "node:fs";
import { basename as basename3, dirname as dirname3, join as join4 } from "node:path";

// src/core/state/paths.ts
import { join as join3 } from "node:path";
var SPECS_DIR = "specs";
var RUNS_DIR = "runs";
var CURRENT_LINK = "current";
var CURRENT_DIR = "current";
var STATE_FILE = "state.json";
function repoKey(repo) {
  const key = repo.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  if (key.length === 0) {
    throw new Error(`repoKey: repo '${repo}' has no usable characters`);
  }
  if (/^\.+$/.test(key)) {
    throw new Error(`repoKey: repo '${repo}' resolves to a path-traversal segment '${key}'`);
  }
  return key;
}
function runsRoot(dataDir) {
  return join3(dataDir, RUNS_DIR);
}
function runDir(dataDir, runId) {
  validateId(runId, "run-id");
  return join3(runsRoot(dataDir), runId);
}
function runStatePath(dataDir, runId) {
  return join3(runDir(dataDir, runId), STATE_FILE);
}
function currentRepoRoot(dataDir) {
  return join3(dataDir, CURRENT_DIR);
}
function currentRepoLinkPath(dataDir, repo) {
  return join3(currentRepoRoot(dataDir), repoKey(repo));
}
function specsRoot(dataDir) {
  return join3(dataDir, SPECS_DIR);
}
function specDir(dataDir, repo, specId) {
  validateId(specId, "spec-id");
  return join3(specsRoot(dataDir), repoKey(repo), specId);
}

// src/core/state/manager.ts
var log7 = createLogger("state");
var DEFAULT_LOCK_TUNING = DEFAULT_FILE_LOCK_TUNING;
function isStaleStateError(err) {
  return err instanceof JsonParseError || err instanceof ZodError || isUsageError(err);
}
var StateManager = class _StateManager {
  dataDir;
  lockTuning;
  constructor(opts = {}) {
    this.dataDir = resolveDataDir(opts);
    this.lockTuning = { ...DEFAULT_LOCK_TUNING, ...opts.lock ?? {} };
  }
  // ---- paths -------------------------------------------------------------
  statePath(runId) {
    return runStatePath(this.dataDir, runId);
  }
  lockfilePath(runId) {
    return join4(runDir(this.dataDir, runId), "state.lock");
  }
  /**
   * Reject any state file not stamped with the CURRENT schema version, with a clear
   * UsageError instead of a raw ZodError. ABSENT rejects too — every writer stamps
   * the version, so an unstamped file predates the current schema. Ephemeral runs
   * can't be migrated; the remedy is always a fresh run.
   */
  static guardedParse(raw, context) {
    const v = raw?.schema_version;
    if (v !== 3) {
      throw new UsageError(
        `run state at '${context}' uses schema v${JSON.stringify(v)}; only v3 is supported \u2014 this state was created by an older factory version; start a fresh run`
      );
    }
    return parseRunState(raw);
  }
  specLockfilePath(repo, specId) {
    return join4(specDir(this.dataDir, repo, specId), "create.lock");
  }
  // ---- lock --------------------------------------------------------------
  /**
   * Acquire `lockfilePath` (whose parent `dir` must already exist), run `fn`, and
   * always release. `realpath:false` lets us lock a path whose target may be
   * mid-rename or not yet exist (proper-lockfile creates `<path>.lock`).
   * `label` names the resource in the loud not-found + compromised errors.
   */
  async runWithLock(dir, lockfilePath, label, fn) {
    return withFileLock({ dir, lockfile: lockfilePath, label, dirPolicy: "assert", tuning: this.lockTuning }, fn);
  }
  /**
   * Run `fn` while holding the per-run lock. The lockfile's parent (the run dir)
   * must already exist — `create` mkdirs it before first lock; mutators lock an
   * existing run.
   */
  async withLock(runId, fn) {
    return this.runWithLock(runDir(this.dataDir, runId), this.lockfilePath(runId), `run '${runId}'`, fn);
  }
  /**
   * Run `fn` while holding the per-spec lock, keyed by `(repo, specId)`. The
   * durable spec dir is the lock parent — it always exists once the spec is
   * resolved, so this is a stable serialization point for the resolve-or-reuse
   * scan→create critical section (two concurrent same-spec creates can't both
   * observe "no active run" and mint two orphan runs; the per-run clobber guard
   * only protects against a same run_id collision). Distinct lockfile from
   * {@link withLock}, so the nested `create` call inside the body never deadlocks.
   */
  async withSpecLock(repo, specId, fn) {
    return this.runWithLock(
      specDir(this.dataDir, repo, specId),
      this.specLockfilePath(repo, specId),
      `spec '${repo}/${specId}'`,
      fn
    );
  }
  // ---- create ------------------------------------------------------------
  /**
   * Create a brand-new run. Mkdirs the run store layout, writes the initial
   * state.json atomically under the lock, and (best-effort) points the per-repo
   * `current/<repo-key>` pointer at it. Refuses to clobber an existing run dir.
   */
  async create(args) {
    const dir = runDir(this.dataDir, args.run_id);
    if (existsSync4(this.statePath(args.run_id))) {
      throw new Error(`state: run '${args.run_id}' already exists`);
    }
    await mkdir3(join4(dir, "holdouts"), { recursive: true });
    await mkdir3(join4(dir, "reviews"), { recursive: true });
    const now = nowIso();
    const state = parseRunState({
      run_id: args.run_id,
      status: "running",
      execution_mode: args.execution_mode ?? "sequential",
      ship_mode: args.ship_mode ?? "live",
      // Stamp the owning session only when known (best-effort) — an ownerless run
      // is INVISIBLE to the Stop gate (findActiveByOwner never matches it; there is
      // no unscoped fallback), so that session's loop can stop freely.
      ...args.owner_session !== void 0 ? { owner_session: args.owner_session } : {},
      staging_branch: args.staging_branch,
      ...args.ignore_quota !== void 0 ? { ignore_quota: args.ignore_quota } : {},
      ...args.e2e !== void 0 ? { e2e: args.e2e } : {},
      ...args.debug !== void 0 ? { debug: args.debug } : {},
      spec: args.spec,
      tasks: args.tasks ?? {},
      ...args.human_touches !== void 0 ? { human_touches: args.human_touches.map((t) => ({ kind: t.kind, at: t.at ?? now })) } : {},
      started_at: now,
      updated_at: now,
      ended_at: null
    });
    await this.withLock(args.run_id, async () => {
      if (existsSync4(this.statePath(args.run_id))) {
        throw new Error(`state: run '${args.run_id}' already exists`);
      }
      await atomicWriteFile(this.statePath(args.run_id), stringifyJson(state));
    });
    await atomicWriteFile(join4(dir, "audit.jsonl"), "");
    await atomicWriteFile(join4(dir, "metrics.jsonl"), "");
    await this.pointCurrentAt(state);
    return state;
  }
  // ---- read (lock-free) --------------------------------------------------
  /**
   * Read + validate a run's state. LOCK-FREE: the atomic rename on the writer
   * side guarantees a reader sees a whole file. LOUD on a missing run or a
   * schema/JSON violation (never a silent partial).
   */
  async read(runId) {
    const path = this.statePath(runId);
    const raw = await readFile(path, "utf8");
    return _StateManager.guardedParse(parseJson(raw, path), path);
  }
  /**
   * True iff a RunState exists on disk for this run id. Synchronous,
   * no read/parse — mirrors the existence check `create()` already uses
   * internally before writing. Lets a caller distinguish "no run was ever
   * created" from a genuine read failure without parsing.
   */
  exists(runId) {
    return existsSync4(this.statePath(runId));
  }
  /**
   * Read the run the PER-REPO current pointer (`current/<repo-key>`, L2.7) names —
   * the authoritative pointer the human CLI resolves per checkout. A per-repo MISS
   * (no pointer for this repo yet) is simply null — `pointCurrentAt` writes both
   * pointers on every create, so a repo with a run always has its per-repo link.
   * Loud on a corrupt state.json behind the pointer (same contract as readCurrent).
   */
  async readCurrentForRepo(repo) {
    return this.readThroughLink(currentRepoLinkPath(this.dataDir, repo));
  }
  /**
   * Read + validate a run's state THROUGH a `current`-style directory symlink (the
   * OS follows the link during the path walk, so no readlink is needed). Returns
   * null ONLY on genuine ABSENCE (missing/dangling link → ENOENT); a corrupt/invalid
   * state.json propagates LOUDLY (swallowing it would make a corrupt active run
   * indistinguishable from "no current run"). Shared by {@link readCurrent} and
   * {@link readCurrentForRepo}.
   */
  async readThroughLink(link) {
    if (!existsSync4(link)) {
      return null;
    }
    const statePath = join4(link, "state.json");
    let raw;
    try {
      raw = await readFile(statePath, "utf8");
    } catch (err) {
      if (isEnoent(err)) {
        return null;
      }
      throw err;
    }
    return _StateManager.guardedParse(parseJson(raw, statePath), statePath);
  }
  // ---- enumerate (lock-free) ---------------------------------------------
  /**
   * Enumerate every run in the store, newest-first (run-id descending — the id is
   * lexicographically chronological). Each run dir's state.json is read + validated
   * through {@link read}. Non-directory entries (the `runs/current` symlink and any
   * `*.tmp.<pid>` link create() leaves behind) are excluded. A run dir without a
   * state.json (mid-creation, or cleaned) is skipped silently; one whose state.json
   * is unreadable/corrupt/invalid is skipped with a LOUD warning — a single corrupt
   * historical run must not brick `run create`'s resolve-or-reuse scan. (Targeted
   * {@link read} keeps its loud-on-corruption contract; only this bulk scan tolerates
   * a bad entry, and never silently.)
   */
  /**
   * Readdir the runs root, tolerating a missing root (no runs yet → []) and
   * filtering to directories (excludes the `current` + temp symlinks). The shared
   * prologue of {@link listRuns} and {@link listStaleRunDirs}.
   */
  async runDirEntries() {
    try {
      const entries = await readdir(runsRoot(this.dataDir), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if (isEnoent(err)) {
        return [];
      }
      throw err;
    }
  }
  async listRuns() {
    const runs = [];
    for (const name of await this.runDirEntries()) {
      try {
        runs.push(await this.read(name));
      } catch (err) {
        if (isEnoent(err)) {
          continue;
        }
        log7.warn(`state: skipping unreadable run '${name}': ${err.message}`);
      }
    }
    return runs.sort((a, b) => b.run_id.localeCompare(a.run_id));
  }
  /**
   * Enumerate the run dirs THIS engine cannot parse (D57) — the population
   * {@link listRuns} warn-skips: an old-schema stamp (`schema_version !== 3`) or
   * corrupt JSON. These are `rescue gc` sweep candidates; a stale pointer at one
   * of them is what crashed `run create` in the 2026-07-07 incident. Best-effort
   * raw field extraction (`staging_branch`, `spec.repo`) enables the GitHub-side
   * teardown; a structurally-invalid v3 state is NOT stale (current-engine
   * wreckage — surfaces loudly through targeted reads, never swept here).
   */
  async listStaleRunDirs() {
    const stale = [];
    for (const name of await this.runDirEntries()) {
      let raw;
      try {
        raw = await readFile(runStatePath(this.dataDir, name), "utf8");
      } catch (err) {
        if (isEnoent(err)) {
          continue;
        }
        throw err;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        stale.push({ run_id: name, reason: "corrupt-json" });
        continue;
      }
      const obj = parsed;
      const v = obj?.schema_version;
      if (v === 3) {
        continue;
      }
      const branch = obj?.staging_branch;
      const repo = obj?.spec?.repo;
      stale.push({
        run_id: name,
        reason: `schema-v${JSON.stringify(v)}`,
        ...typeof branch === "string" && branch.length > 0 ? { staging_branch: branch } : {},
        ...typeof repo === "string" && repo.length > 0 ? { repo } : {}
      });
    }
    return stale.sort((a, b) => b.run_id.localeCompare(a.run_id));
  }
  /**
   * Delete a run dir outright and drop any `current` pointer naming it (D57) —
   * `rescue gc --apply`'s stale-run sweep. NOT a lifecycle verb: live runs are
   * cancelled/superseded through state, never deleted; this exists solely for
   * wreckage {@link read} cannot even parse, so it takes no lock (there is no
   * valid state to serialize against).
   */
  async deleteRun(runId) {
    await rm(runDir(this.dataDir, runId), { recursive: true, force: true });
    const links = [];
    try {
      const repoLinks = await readdir(currentRepoRoot(this.dataDir), { withFileTypes: true });
      links.push(...repoLinks.map((e) => join4(currentRepoRoot(this.dataDir), e.name)));
    } catch (err) {
      if (!isEnoent(err)) {
        throw err;
      }
    }
    for (const link of links) {
      let target;
      try {
        target = await readlink(link);
      } catch {
        continue;
      }
      if (basename3(target) === runId) {
        await rm(link, { force: true }).catch(() => {
        });
      }
    }
  }
  /**
   * Find the single NON-terminal run for `(repo, issueNumber)`, or null. Powers the
   * resolve-or-reuse path of `run create`: a repeated create returns the live run
   * instead of spawning an orphan. Matches by the STABLE issue number, not the exact
   * `spec_id` — a spec id is `<issue>-<slug>` where the slug is agent-named and can
   * drift across regenerations, and one issue means at most one active run: the
   * supersede teardown, the weekly-quota wall, and the no-silent-reuse prompt must
   * all see a drifted-slug run.
   *
   * @throws when ≥2 active runs match — a state defect (duplicates have occurred in
   *         the wild); silently picking one could tear down or reuse the wrong run.
   *         Fail loud and let `/factory:resume` repair.
   */
  async findActiveByIssue(repo, issueNumber) {
    const runs = await this.listRuns();
    const matches = runs.filter(
      (r) => r.spec.repo === repo && r.spec.issue_number === issueNumber && !isTerminalRunStatus(r.status)
    );
    if (matches.length > 1) {
      throw new Error(
        `findActiveByIssue: ${matches.length} active runs for issue #${issueNumber} in ${repo} (${matches.map((r) => r.run_id).join(", ")}) \u2014 one issue must have at most one active run; repair with /factory:resume`
      );
    }
    return matches.length === 1 ? at(matches, 0) : null;
  }
  /**
   * TRUE when another NON-terminal run (any issue) exists for `repo` besides
   * `excludeRunId`. Active-run uniqueness is per (repo, issue) — two PRDs can
   * have simultaneously active runs on one repo — so the D74 de-escalation
   * sites (finalize / supersede / cancel `--cleanup`) and scaffold's
   * `--provision` must not drop develop to baseline while a sibling run still
   * relies on the strict profile.
   */
  async hasOtherActiveForRepo(repo, excludeRunId) {
    const runs = await this.listRuns();
    return runs.some((r) => r.spec.repo === repo && r.run_id !== excludeRunId && !isTerminalRunStatus(r.status));
  }
  /**
   * ALL non-terminal runs owned by `session` (its `owner_session`), newest-first
   * (empty session → `[]`). The raw list behind {@link findActiveByOwner}: callers
   * that must DISTINGUISH "none owned" from "ambiguous (≥2 owned)" — e.g. `run cancel`,
   * which fails LOUD on ambiguity rather than guessing which run to abandon — branch
   * on `.length`.
   */
  async findAllActiveByOwner(session) {
    if (session.length === 0) {
      return [];
    }
    const runs = await this.listRuns();
    return runs.filter((r) => r.owner_session === session && !isTerminalRunStatus(r.status));
  }
  /**
   * Find the SINGLE non-terminal run owned by `session` (its `owner_session`), or
   * null. Powers the session-scoped Bash guards (run-isolation L1.3): a guard fires
   * only for the run the stopping/acting session actually owns, never a concurrent
   * run in another repo. An empty session, no match, or ≥2 matches (ambiguous — one
   * session minting runs in two repos) all return null, so the caller fails SAFE
   * (passes through) rather than gating the wrong run. Callers that must tell "none"
   * from "ambiguous" apart use {@link findAllActiveByOwner} and branch on its length.
   */
  async findActiveByOwner(session) {
    const owned = await this.findAllActiveByOwner(session);
    return owned.length === 1 ? at(owned, 0) : null;
  }
  // ---- update (locked read-modify-write) ---------------------------------
  /**
   * Atomically mutate a run under the lock. `mutator` receives the current state
   * and returns the next state; the result is re-validated through the schema
   * (so a mutator cannot persist an out-of-enum value) and `updated_at` is
   * stamped. This is the ONLY write path for an existing run.
   */
  async update(runId, mutator) {
    return this.withLock(runId, async () => {
      const current = await this.read(runId);
      const next = await mutator(current);
      if (next.run_id !== runId) {
        throw new Error(
          `state: update mutator changed run_id ('${runId}' \u2192 '${next.run_id}') \u2014 identity is immutable`
        );
      }
      if (next.spec.repo !== current.spec.repo || next.spec.spec_id !== current.spec.spec_id || next.spec.issue_number !== current.spec.issue_number) {
        throw new Error(
          `state: update mutator changed the spec pointer for run '${runId}' \u2014 identity is immutable`
        );
      }
      const validated = parseRunState({
        ...next,
        updated_at: nowIso()
      });
      await atomicWriteFile(this.statePath(runId), stringifyJson(validated));
      return validated;
    });
  }
  /**
   * Convenience: mutate a single task in place. Throws if the task is absent
   * (a typo'd task id is a loud error, not a silent create).
   */
  async updateTask(runId, taskId, mutator) {
    return this.update(runId, (state) => {
      const task = state.tasks[taskId];
      if (!task) {
        throw new Error(`state: run '${runId}' has no task '${taskId}'`);
      }
      return { ...state, tasks: { ...state.tasks, [taskId]: mutator(task) } };
    });
  }
  async finalize(runId, status, reason) {
    if (!isTerminalRunStatus(status)) {
      throw new Error(`state: finalize requires a terminal status (completed|failed|superseded); got '${status}'`);
    }
    if (status === "completed" && reason !== void 0) {
      throw new Error(`state: finalize 'completed' takes no reason; got '${reason}'`);
    }
    if (status !== "completed" && (reason === void 0 || reason.trim().length === 0)) {
      throw new Error(`state: finalize '${status}' requires a non-empty reason`);
    }
    return this.update(runId, (state) => {
      if (isTerminalRunStatus(state.status) && state.status !== status) {
        throw new Error(
          `state: run '${runId}' already terminal as '${state.status}'; cannot re-finalize as '${status}'`
        );
      }
      if (isTerminalRunStatus(state.status) && state.terminal_reason !== void 0 && reason !== void 0 && state.terminal_reason !== reason) {
        throw new Error(
          `state: run '${runId}' already finalized '${status}' with reason '${state.terminal_reason}'; refusing to replace it with '${reason}'`
        );
      }
      return {
        ...state,
        status,
        quota: void 0,
        terminal_reason: state.terminal_reason ?? reason,
        ended_at: state.ended_at ?? nowIso()
      };
    });
  }
  // ---- current symlink ---------------------------------------------------
  /**
   * Repoint the PER-REPO current pointer `current/<repo-key>` → `../runs/<run-id>`
   * at a freshly-created run (L2.6/L2.7) — the single live pointer, authoritative
   * for the human CLI per checkout. The legacy GLOBAL `runs/current` link is
   * RETIRED (Decision 61): nothing reads it; this method only best-effort rms a
   * leftover from an older engine.
   *
   * CLOBBER GUARD (L2.6) — runs BEFORE any write and throws LOUD (NOT swallowed by the
   * best-effort symlink catch below): if THIS repo's current pointer already names a
   * still-live run owned by a DIFFERENT known session, refuse to hide it. Same-repo
   * concurrent runs by distinct sessions are thus serialized, while cross-repo creates
   * (a different repo's pointer) never trip it. The just-created run's `state.json`
   * already exists, so it stays addressable via `--run <id>` after the throw.
   * Degrades safe (no refusal) when either owner is unknown — today's last-wins behavior.
   *
   * POINTER-LIVENESS TOLERANCE (D57): an UNPARSEABLE pointer target (old-schema,
   * corrupt JSON) classifies as STALE — warn loudly and repoint. A run this engine
   * cannot parse cannot be owned by a live session of this engine, so it can never
   * prove the "still-live, different owner" condition the guard exists for. Mirrors
   * {@link listRuns}' tolerate-loudly precedent; readCurrentForRepo keeps its loud
   * contract for every other caller.
   *
   * The tolerance is SCOPED to recognized parse/schema failures ({@link isStaleStateError}
   * — JSON parse errors, the schema-version UsageError, or a Zod validation error);
   * any other error (EACCES, EIO, or an unexpected bug) rethrows loudly instead of
   * being treated as stale, so a transient read failure on a genuinely live,
   * different-owner run never silently repoints over it.
   */
  async pointCurrentAt(state) {
    const repo = state.spec.repo;
    let existing;
    try {
      existing = await this.readCurrentForRepo(repo);
    } catch (err) {
      if (!isStaleStateError(err)) {
        throw err;
      }
      log7.warn(
        `state: current pointer for repo '${repo}' names an unparseable run \u2014 treating as stale and repointing: ${err.message}`
      );
      existing = null;
    }
    if (existing !== null && existing.run_id !== state.run_id && !isTerminalRunStatus(existing.status) && existing.owner_session !== void 0 && state.owner_session !== void 0 && existing.owner_session !== state.owner_session) {
      throw new Error(
        `state: refusing to repoint current for repo '${repo}' \u2014 run '${existing.run_id}' is still live (owned by a different session '${existing.owner_session}'). Run '${state.run_id}' was created and is addressable via \`--run ${state.run_id}\`; finalize or rescue '${existing.run_id}' before starting a concurrent run in this repo.`
      );
    }
    await this.repointSymlink(currentRepoLinkPath(this.dataDir, repo), join4("..", RUNS_DIR, state.run_id));
    await rm(join4(runsRoot(this.dataDir), CURRENT_LINK), { force: true }).catch(() => {
    });
  }
  /**
   * Atomically-ish repoint a `current`-style symlink at `target` (write a temp link
   * then rename). Best-effort: a failure is logged, not fatal — `current` is a
   * convenience pointer, not load-bearing state.
   */
  async repointSymlink(link, target) {
    const tmp = `${link}.tmp.${process.pid}`;
    try {
      await mkdir3(dirname3(link), { recursive: true });
      await unlink2(tmp).catch(() => {
      });
      await symlink(target, tmp);
      await rm(link, { force: true, recursive: false }).catch(() => {
      });
      await rename2(tmp, link);
    } catch (err) {
      log7.warn(`state: could not update current pointer '${link}' \u2192 '${target}': ${err.message}`);
      await unlink2(tmp).catch(() => {
      });
    }
  }
};

// src/core/phase-machine/phases.ts
var TaskPhaseEnum = external_exports.enum(TASK_PHASES);
var RunPhaseEnum = external_exports.enum(["finalize"]);

// src/core/phase-machine/spawn.ts
var SpawnRoleEnum = external_exports.enum([
  "test-writer",
  "implementer",
  "implementation-reviewer",
  "quality-reviewer",
  "silent-failure-hunter",
  "systemic-failure-reviewer",
  "database-design-reviewer",
  "scribe"
]);
var AgentSpecSchema = external_exports.object({
  /** The reviewer/producer role (closed set). */
  role: SpawnRoleEnum,
  /** The runner-facing `Task(subagent_type)` value, spawned verbatim (C4). */
  agent_type: external_exports.string().min(1),
  /** Worktree isolation. Defaults to "worktree". */
  isolation: external_exports.enum(["worktree", "none"]).default("worktree"),
  /** Model identifier to run the agent on (non-empty; WS8 resolves the value). */
  model: external_exports.string().min(1),
  /**
   * Optional hard turn budget for the agent (positive integer). Omitted ⇒ the runner
   * falls back to the agent's own frontmatter `maxTurns` (single-source-of-truth —
   * mirrors how `effort` already works below). Set only when the engine deliberately
   * overrides the frontmatter default.
   */
  max_turns: external_exports.number().int().positive().optional(),
  /**
   * The composed agent prompt, spawned VERBATIM (3b(i)/(ii)). Producer specs
   * always set it (`handlers.ts` `producerSpawn`); panel reviewer specs omit it —
   * the runner still builds those prompts inline from `agents/<role>.md` +
   * `skills/review-protocol/SKILL.md` (unchanged).
   */
  prompt: external_exports.string().min(1).optional(),
  /**
   * Optional effort/reasoning level to spawn at (the closed {@link EffortEnum}:
   * low|medium|high|xhigh|max). Omitted ⇒ inherit the spawn default. Set by the
   * producer dial's effort climb (`model-dial.ts`) on high escalation rungs.
   */
  effort: EffortEnum.optional()
});
var CrossVendorStampSchema = external_exports.union([
  external_exports.object({ status: external_exports.literal("present"), model: external_exports.string().min(1), prompt: external_exports.string().min(1) }),
  external_exports.object({ status: external_exports.literal("absent"), reason: external_exports.string().min(1) })
]);
var VerifierSpecSchema = external_exports.object({
  agent_type: external_exports.string().min(1),
  model: external_exports.string().min(1),
  isolation: external_exports.enum(["worktree", "none"]).default("worktree"),
  prompt_template: external_exports.string().min(1),
  interpolate_fields: external_exports.array(external_exports.string().min(1)).min(1)
});
var SpawnRequestSchema = external_exports.object({
  /** Engine resumes here after the agents return. A per-task phase. */
  resume_phase: TaskPhaseEnum,
  /** Agents to spawn; at least one (an empty request is a programming error). */
  agents: external_exports.array(AgentSpecSchema).min(1),
  /** Cross-vendor resolution — verify panel manifests only (S5/C). */
  cross_vendor: CrossVendorStampSchema.optional(),
  /** Finding-verifier spawn template — verify panel manifests only (3b/iii). */
  verifier_spec: VerifierSpecSchema.optional()
});

// src/hooks/hook-context.ts
import { isAbsolute as isAbsolute2, relative, sep as sep5 } from "node:path";

// src/git/exec-tools.ts
function makeRunner(command) {
  return (args, opts) => exec(command, args, opts);
}
var defaultGitRunner = makeRunner("git");
var defaultGhRunner = makeRunner("gh");
async function runOrThrow(command, runner, args, opts) {
  const result = await runner(args, opts);
  if (result.code !== 0) {
    throw new ExecError(command, args, result);
  }
  return result;
}

// src/git/git-client.ts
import { dirname as dirname4 } from "node:path";
var log8 = createLogger("git");
var DefaultGitClient = class {
  runner;
  constructor(runner = defaultGitRunner) {
    this.runner = runner;
  }
  toExecOpts(opts) {
    return opts?.cwd != null && opts.cwd.length > 0 ? { cwd: opts.cwd } : {};
  }
  exec(args, opts) {
    return this.runner(args, this.toExecOpts(opts));
  }
  execOrThrow(args, opts) {
    return runOrThrow("git", this.runner, args, this.toExecOpts(opts));
  }
  async fetch(remote, ref, opts) {
    await this.execOrThrow(["fetch", remote, ref], opts);
  }
  async revParse(ref, opts) {
    const r = await this.execOrThrow(["rev-parse", ref], opts);
    return r.stdout.trim();
  }
  async branchExists(ref, opts) {
    const fullRef = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
    const r = await this.exec(["show-ref", "--verify", "--quiet", fullRef], opts);
    if (r.code === 0) {
      return true;
    }
    if (r.code === 1) {
      return false;
    }
    throw new Error(`git show-ref failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
  }
  async refExists(ref, opts) {
    const r = await this.exec(["rev-parse", "--verify", "--quiet", ref], opts);
    if (r.code === 0) {
      return true;
    }
    if (r.code === 1) {
      return false;
    }
    throw new Error(`git rev-parse failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
  }
  async isTracked(relPath, opts) {
    const r = await this.exec(["ls-files", "--error-unmatch", "--", relPath], opts);
    if (r.code === 0) {
      return true;
    }
    if (r.code === 1) {
      return false;
    }
    throw new Error(`git ls-files failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
  }
  async commitsAhead(base, branch, opts) {
    const r = await this.execOrThrow(["rev-list", "--count", `${base}..${branch}`], opts);
    const n = Number.parseInt(r.stdout.trim(), 10);
    if (!Number.isFinite(n)) {
      throw new Error(`git rev-list --count returned non-numeric output: ${JSON.stringify(r.stdout)}`);
    }
    return n;
  }
  async checkoutB(branch, startPoint, opts) {
    log8.debug(`checkout -B ${branch} ${startPoint}`);
    await this.execOrThrow(["checkout", "-B", branch, startPoint], opts);
  }
  async currentBranch(opts) {
    const r = await this.execOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], opts);
    return r.stdout.trim();
  }
  async showToplevel(opts) {
    const r = await this.execOrThrow(["rev-parse", "--show-toplevel"], opts);
    return r.stdout.trim();
  }
  async mainWorktreeRoot(opts) {
    const r = await this.execOrThrow(["rev-parse", "--path-format=absolute", "--git-common-dir"], opts);
    return dirname4(r.stdout.trim());
  }
  async remoteUrl(remote, opts) {
    const r = await this.exec(["remote", "get-url", remote], opts);
    if (r.code !== 0) {
      return null;
    }
    const url = r.stdout.trim();
    return url.length > 0 ? url : null;
  }
  async lsRemoteHeads(remote, branch, opts) {
    const r = await this.execOrThrow(["ls-remote", "--heads", remote, branch], opts);
    const line = r.stdout.trim();
    if (line.length === 0) {
      return null;
    }
    const sha = line.split(/\s+/)[0];
    return sha != null && sha.length > 0 ? sha : null;
  }
  async mergeBase(a, b, opts) {
    const r = await this.execOrThrow(["merge-base", a, b], opts);
    return r.stdout.trim();
  }
  async worktreeAdd(args, opts) {
    await this.execOrThrow(["worktree", "add", ...args], opts);
  }
  async worktreeExists(path, opts) {
    const r = await this.execOrThrow(["worktree", "list", "--porcelain"], opts);
    return r.stdout.split("\n").some((line) => line === `worktree ${path}`);
  }
  async worktreeRemove(args, opts) {
    const r = await this.exec(["worktree", "remove", ...args], opts);
    return r.code;
  }
  async push(remote, branch, opts) {
    const args = ["push"];
    if (opts?.setUpstream === true) {
      args.push("-u");
    }
    args.push(remote, branch);
    await this.execOrThrow(args, opts);
  }
  async mergeFfOrCommit(branch, ref, opts) {
    log8.debug(`merge --no-edit ${ref} into ${branch}`);
    await this.execOrThrow(["checkout", branch], opts);
    await this.execOrThrow(["merge", "--no-edit", ref], opts);
  }
  async tryMergeNoForce(branch, ref, opts) {
    const mergeArgs = opts?.message !== void 0 ? ["merge", "-m", opts.message, ref] : ["merge", "--no-edit", ref];
    log8.debug(`tryMerge ${mergeArgs.slice(1).join(" ")} into ${branch}`);
    await this.execOrThrow(["checkout", branch], opts);
    const r = await this.exec(mergeArgs, opts);
    if (r.code === 0) {
      return { merged: true };
    }
    const conflict = (r.stderr.trim().length > 0 ? r.stderr : r.stdout).trim() || `git merge exited ${r.code ?? "null"}`;
    await this.exec(["merge", "--abort"], opts);
    return { merged: false, conflict };
  }
  async resetHardClean(ref, opts) {
    log8.debug(`reset --hard ${ref} && clean -fd`);
    await this.execOrThrow(["reset", "--hard", ref], opts);
    await this.execOrThrow(["clean", "-fd"], opts);
  }
  async diffNames(base, ref, opts) {
    const r = await this.execOrThrow(["diff", "--name-only", `${base}...${ref}`], opts);
    return r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  }
};

// src/git/repo.ts
function parseRemoteUrl(url) {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let path;
  const scp = /^[^/@]+@[^/:]+:(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes("://")) {
    path = scp[1];
  } else {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.+)$/.exec(trimmed);
    if (withScheme) {
      const afterScheme = nonNull(withScheme[1]);
      const firstSlash = afterScheme.indexOf("/");
      if (firstSlash >= 0) {
        path = afterScheme.slice(firstSlash + 1);
      }
    }
  }
  if (path === void 0) {
    return null;
  }
  let p = path.replace(/\/+$/, "");
  p = p.replace(/\.git$/i, "");
  const segments = p.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) {
    return null;
  }
  const name = at(segments, segments.length - 1);
  const owner = at(segments, segments.length - 2);
  if (owner.length === 0 || name.length === 0) {
    return null;
  }
  return `${owner}/${name}`;
}
var REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;
function isValidRepoSlug(slug) {
  const parts = slug.split("/");
  return parts.length === 2 && parts.every((seg) => REPO_SEGMENT.test(seg) && seg !== "." && seg !== "..");
}
function validateRepoSlug(slug) {
  if (!isValidRepoSlug(slug)) {
    throw new UsageError(
      `--repo must be '<owner>/<name>' where each part is [A-Za-z0-9._-] and not '.'/'..' (no slashes, spaces, or other characters), got '${slug}'`
    );
  }
  return slug;
}
async function resolveRepo(args) {
  const remote = args.remote ?? "origin";
  const explicit = typeof args.explicit === "string" && args.explicit.length > 0 ? validateRepoSlug(args.explicit) : void 0;
  const derived = await deriveRepo(args.gitClient, remote, args.cwd);
  if (explicit !== void 0) {
    if (derived === null) {
      return explicit;
    }
    if (explicit.toLowerCase() === derived.toLowerCase()) {
      return derived;
    }
    throw new UsageError(
      `--repo '${explicit}' disagrees with the '${remote}' remote ('${derived}'); omit --repo to use the remote, or fix the value`
    );
  }
  if (derived === null) {
    throw new UsageError(
      `--repo is required: could not derive it from the '${remote}' remote (run from a repo checkout with an '${remote}' remote, or pass --repo <owner/name>)`
    );
  }
  return validateRepoSlug(derived);
}
async function deriveRepo(gitClient, remote, cwd) {
  const url = await gitClient.remoteUrl(remote, { cwd });
  if (url === null) {
    return null;
  }
  return parseRemoteUrl(url);
}

// src/git/gh-client.ts
var log9 = createLogger("gh");
var PullRequestSchema = external_exports.object({
  number: external_exports.number().int(),
  headRefName: external_exports.string(),
  baseRefName: external_exports.string(),
  state: external_exports.enum(["OPEN", "CLOSED", "MERGED"]),
  mergeable: external_exports.string().optional(),
  mergeStateStatus: external_exports.string().optional(),
  mergeCommit: external_exports.object({ oid: external_exports.string() }).nullish(),
  url: external_exports.string().optional()
});
var REQUIRED_VIEW_FIELDS = Object.entries(PullRequestSchema.shape).filter(([, schema]) => !schema.isOptional()).map(([key]) => key);
var GhChecksSchema = external_exports.array(external_exports.object({ bucket: external_exports.string().optional() }));
var GhProtectionSchema = external_exports.object({
  required_status_checks: external_exports.object({ strict: external_exports.boolean().optional(), contexts: external_exports.array(external_exports.string()).optional() }).nullish()
});
var GhRulesSchema = external_exports.array(external_exports.object({ type: external_exports.string().optional() }));

// src/git/rollup.ts
var log10 = createLogger("git");
var GIT_DEFAULTS = GitSchema.parse({});

// src/git/branch.ts
var DEFAULT_PREFIX = GitSchema.parse({}).branchPrefix;

// src/git/worktree.ts
var log11 = createLogger("git");

// src/git/provision.ts
var log12 = createLogger("provision");

// src/git/pr.ts
var log13 = createLogger("git");

// src/git/serial-writer.ts
var log14 = createLogger("git");
var MERGE_LOCK_DEFAULTS = {
  ...DEFAULT_FILE_LOCK_TUNING,
  stale: 3e4,
  retries: 100,
  retryMinTimeout: 25,
  retryMaxTimeout: 1e3
};

// src/shared/command-allowlist.ts
var SAFE_TOKEN = /^[A-Za-z0-9._/=:+-]+$/;
function runnerName(argv) {
  const bin = argv[0] ?? "";
  return bin.includes("/") ? bin.slice(bin.lastIndexOf("/") + 1) : bin;
}
function validateCommand(command, isAllowedRunner) {
  const tokens = command.split(/\s+/).filter((t) => t.length > 0);
  for (const t of tokens) {
    if (!SAFE_TOKEN.test(t)) {
      return { ok: false, reason: "unsafe_command", detail: `unsafe token '${t}'` };
    }
  }
  if (tokens[0] === void 0) {
    return { ok: false, reason: "unsafe_command", detail: "empty command" };
  }
  if (!isAllowedRunner(tokens)) {
    return {
      ok: false,
      reason: "unallowed_runner",
      detail: `runner '${runnerName(tokens)}' not allowlisted`
    };
  }
  return { ok: true, argv: tokens };
}

// src/verifier/deterministic/gate-id.ts
var GATE_IDS = [
  "test",
  "tdd",
  "coverage",
  "mutation",
  "sast",
  "type",
  "lint",
  "build"
];

// src/verifier/deterministic/gate-contract.ts
var log15 = createLogger("gate-contract");
var MUTATION_CHECK_CONTEXT = "Mutation Testing";
var GATE_CONTRACT_STACKS = ["npm", "deno", "custom"];
var COMMAND_GATES = ["test", "type", "build", "lint", "coverage"];
function isAllowedGateRunner(argv) {
  const runner = runnerName(argv);
  const a1 = argv[1];
  switch (runner) {
    case "deno":
      return a1 === "test" || a1 === "check" || a1 === "task" || a1 === "lint" || a1 === "fmt";
    case "go":
      return a1 === "test";
    case "cargo":
      return a1 === "test" || a1 === "check" || a1 === "build";
    case "npm":
    case "pnpm":
    case "yarn":
      return a1 === "run" && argv[2] !== void 0;
    case "vitest":
    case "tsc":
    case "eslint":
    case "jest":
    case "mocha":
    case "pytest":
      return true;
    default:
      return false;
  }
}
function validateGateCommand(command) {
  return validateCommand(command, isAllowedGateRunner);
}
var ROOT_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;
var RootsSchema = external_exports.array(
  external_exports.string().refine((r) => r.split("/").every((seg) => ROOT_SEGMENT_RE.test(seg)), {
    message: "mutation root must be a plain repo-relative directory path (no globs, no leading /)"
  }).refine((r) => r.split("/").every((seg) => seg !== ".." && seg !== "."), {
    message: "mutation root must not contain '.' or '..' segments"
  })
).nonempty("mutation roots must name at least one directory");
var ContractedSchema = external_exports.object({
  contracted: external_exports.literal(true),
  /** Stack-specific command override; validated + only on {@link COMMAND_GATES}. */
  command: external_exports.string().optional(),
  /** Mutable-source roots (mutation gate ONLY); defaults to {@link MUTATION_DEFAULT_ROOTS}. */
  roots: RootsSchema.optional()
}).strict();
var UncontractedSchema = external_exports.object({
  contracted: external_exports.literal(false),
  /** Why this gate is waived — required; the committed audit trail. */
  reason: external_exports.string().min(1, "uncontracted gate requires a non-empty reason")
}).strict();
var EntrySchema = external_exports.discriminatedUnion("contracted", [ContractedSchema, UncontractedSchema]);
var SetupStepSchema = external_exports.object({
  name: external_exports.string().min(1).optional(),
  uses: external_exports.string().min(1).optional(),
  with: external_exports.record(external_exports.string()).optional(),
  run: external_exports.string().min(1).optional()
}).strict().superRefine((step, issues) => {
  if (step.uses === void 0 === (step.run === void 0)) {
    issues.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "setup step requires exactly one of 'uses' or 'run'"
    });
  }
  if (step.with !== void 0 && step.uses === void 0) {
    issues.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "'with' is only allowed on a 'uses' step"
    });
  }
});
var GateContractSchema = external_exports.object({
  version: external_exports.literal(1),
  stack: external_exports.enum(GATE_CONTRACT_STACKS),
  gates: external_exports.object(Object.fromEntries(GATE_IDS.map((id) => [id, EntrySchema]))).strict(),
  /** CI env-boot steps rendered into the managed workflow (Decision 73). */
  setup_steps: external_exports.array(SetupStepSchema).optional(),
  /**
   * Extra required CI contexts for this repo's develop branch, merged into
   * BOTH protection profiles (run + baseline) — additive-only per-repo
   * required checks (e.g. outsidey's `pgTAP`). `'Mutation Testing'` is
   * rejected here — it has its own switch below.
   */
  requiredChecks: external_exports.array(external_exports.string().min(1, "requiredChecks entries must be non-empty")).refine((cs) => !cs.includes(MUTATION_CHECK_CONTEXT), {
    message: `'${MUTATION_CHECK_CONTEXT}' is managed by the profiles \u2014 use requireMutationAtRest instead`
  }).optional(),
  /**
   * Keep `'Mutation Testing'` required on develop's BASELINE profile too
   * (at rest, between runs) instead of the default run-profile-only.
   */
  requireMutationAtRest: external_exports.boolean().optional()
}).strict().superRefine((contract, issues) => {
  for (const id of GATE_IDS) {
    const entry = contract.gates[id];
    if (entry.contracted && entry.roots !== void 0 && id !== "mutation") {
      issues.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["gates", id, "roots"],
        message: `gate '${id}' does not use mutable-source roots (allowed on: mutation)`
      });
    }
    if (!entry.contracted || entry.command === void 0) {
      continue;
    }
    if (!COMMAND_GATES.includes(id)) {
      issues.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["gates", id, "command"],
        message: `gate '${id}' does not execute a command override (allowed on: ${COMMAND_GATES.join(", ")})`
      });
      continue;
    }
    const v = validateGateCommand(entry.command);
    if (!v.ok) {
      issues.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["gates", id, "command"],
        message: `${v.reason}: ${v.detail}`
      });
    }
  }
});

// src/git/protection.ts
var log16 = createLogger("git");

// src/git/staging.ts
var log17 = createLogger("git");
var GIT_DEFAULTS2 = GitSchema.parse({});

// src/hooks/hook-context.ts
async function loadOwnerScopedRun(opts = {}) {
  let dataDir;
  try {
    dataDir = resolveDataDir(opts);
  } catch {
    return null;
  }
  const manager = new StateManager({ ...opts, dataDir });
  const env = opts.env ?? process.env;
  const session = (env.CLAUDE_CODE_SESSION_ID ?? "").trim();
  if (session.length > 0) {
    const run = await manager.findActiveByOwner(session);
    return run === null ? null : { dataDir, run };
  }
  if (opts.cwd !== void 0 && opts.cwd.length > 0) {
    const gitClient = opts.gitClient ?? new DefaultGitClient();
    try {
      const repo = await resolveRepo({ cwd: opts.cwd, gitClient });
      const run = await manager.readCurrentForRepo(repo);
      if (run !== null) {
        return { dataDir, run };
      }
    } catch (err) {
      if (!(err instanceof UsageError)) {
        throw err;
      }
    }
  }
  const runs = await manager.listRuns();
  const active = runs.find((r) => !isTerminalRunStatus(r.status));
  return active === void 0 ? null : { dataDir, run: active };
}
function runTaskForPath(worktreesRoot, absPath) {
  if (worktreesRoot.length === 0 || absPath.length === 0) {
    return null;
  }
  const rootCanon = canonicalizePath(worktreesRoot);
  const pathCanon = canonicalizePath(absPath);
  const rel = relative(rootCanon, pathCanon);
  if (rel.length === 0 || rel === ".." || rel.startsWith(`..${sep5}`) || isAbsolute2(rel)) {
    return null;
  }
  const segments = rel.split(sep5);
  if (segments.length < 2) {
    return null;
  }
  const [run_id, task_id] = segments;
  if (run_id == null || run_id.length === 0 || task_id == null || task_id.length === 0) {
    return null;
  }
  if (!isValidId(run_id) || !isValidId(task_id)) {
    return null;
  }
  return { run_id, task_id };
}
var IN_FLIGHT_STATUSES = /* @__PURE__ */ new Set(["executing", "reviewing", "shipping"]);
function activePhaseOf(task) {
  if (!IN_FLIGHT_STATUSES.has(task.status)) {
    return null;
  }
  return task.phase ?? null;
}
function resolveActiveTask(run, explicitTaskId) {
  const taskId = explicitTaskId ?? process.env.FACTORY_TASK_ID ?? "";
  if (taskId.length > 0) {
    const task2 = run.tasks[taskId];
    if (!task2) {
      return null;
    }
    return { task: task2, phase: activePhaseOf(task2) };
  }
  const inFlight = Object.values(run.tasks).filter(
    (t) => t.status === "executing" || t.status === "reviewing" || t.status === "shipping"
  );
  if (inFlight.length !== 1) {
    return null;
  }
  const task = at(inFlight, 0);
  return { task, phase: activePhaseOf(task) };
}
function isTestWriterPhase(active) {
  if (!active) {
    return false;
  }
  if (active.phase !== TaskPhaseEnum.enum.tests) {
    return false;
  }
  return active.task.producer_role === void 0 || active.task.producer_role === "test-writer";
}

// src/hooks/pipeline-guards.ts
var WRITE_TOOLS2 = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit"]);
var GH_PR_CREATE_RE = /(^|[\s&;|(])gh\s+pr\s+create\b/;
var GH_PR_MERGE_RE = /(^|[\s&;|(])gh\s+pr\s+merge\b/;
function isGhPrCreate(cmd) {
  return GH_PR_CREATE_RE.test(cmd);
}
function isGhPrMerge(cmd) {
  return GH_PR_MERGE_RE.test(cmd);
}
function isPlausiblyUnderClaudeWorktrees(p) {
  const segments = p.split(/[/\\]/);
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i] === ".claude" && segments[i + 1] === "worktrees") {
      return true;
    }
  }
  return false;
}
async function decideWriteScope(input, deps) {
  const targets = filePathsOf(input);
  if (targets.length === 0 || !targets.some(isPlausiblyUnderClaudeWorktrees)) {
    return null;
  }
  const gitClient = deps.gitClient ?? new DefaultGitClient();
  const cwd = deps.cwd ?? input?.cwd;
  let workDir;
  try {
    workDir = join5(await gitClient.mainWorktreeRoot(cwd !== void 0 ? { cwd } : {}), ".claude", "worktrees");
  } catch {
    return null;
  }
  const loadRunById = deps.loadRunById ?? ((dir, runId) => new StateManager({ ...deps, dataDir: dir }).read(runId));
  for (const target of targets) {
    const ref = runTaskForPath(workDir, target);
    if (ref === null) {
      continue;
    }
    let dataDir;
    try {
      dataDir = resolveDataDir(deps);
    } catch {
      return deny(
        "test_writer_scope_broken",
        `write to '${target}' resolves to run '${ref.run_id}' / task '${ref.task_id}', but the plugin data dir cannot be resolved; failing closed.`
      );
    }
    let run;
    try {
      run = await loadRunById(dataDir, ref.run_id);
    } catch (err) {
      if (err.code === "ENOENT") {
        continue;
      }
      return deny(
        "test_writer_scope_broken",
        `write to '${target}' resolves to run '${ref.run_id}' / task '${ref.task_id}', whose run state exists but cannot be read; failing closed.`
      );
    }
    const activeTask = resolveActiveTask(run, ref.task_id);
    if (isTestWriterPhase(activeTask) && !isTestPath(target)) {
      return deny(
        "test_writer_scope",
        `Test-writer phase: only test files allowed. Detected write to '${target}'. Move implementation code to the GREEN (exec) phase.`
      );
    }
  }
  return null;
}
async function decidePipelineGuards(input, deps = {}) {
  const tool = toolNameOf(input);
  const cmd = commandOf(input);
  if (WRITE_TOOLS2.has(tool)) {
    const scoped = await decideWriteScope(input, deps);
    if (scoped !== null) {
      return scoped;
    }
  }
  if (cmd.length === 0) {
    return allow();
  }
  const loadRun = deps.loadRun ?? loadOwnerScopedRun;
  const cwd = deps.cwd ?? input?.cwd;
  const active = await loadRun({ ...deps, ...cwd !== void 0 ? { cwd } : {} });
  if (active === null) {
    return allow();
  }
  if (isNestedShellOrHookBypass(cmd)) {
    return deny(
      "nested_shell_denied",
      `nested-shell or hook-bypass not allowed while a pipeline run is active: ${cmd}`
    );
  }
  if (tool === "Bash" && (isGhPrCreate(cmd) || isGhPrMerge(cmd))) {
    const op = isGhPrCreate(cmd) ? "gh pr create" : "gh pr merge";
    return deny(
      "ship_agent_denied",
      `agent-initiated '${op}' is not allowed while a pipeline run is active: the factory engine opens and merges PRs deterministically, never an agent.`
    );
  }
  return allow();
}
async function runPipelineGuards(_argv = [], deps = {}) {
  let input;
  try {
    const raw = deps.readRaw ? await deps.readRaw() : await readStdin();
    input = parseHookInput(raw);
  } catch {
    const decision2 = deny("malformed_hook_input", "pipeline-guards: unparseable hook input");
    emitPermissionDecision(decision2);
    return EXIT.ERROR;
  }
  let decision;
  try {
    decision = await decidePipelineGuards(input, deps);
  } catch (err) {
    decision = deny("pipeline_guard_error", err.message);
    emitPermissionDecision(decision);
    return EXIT.ERROR;
  }
  emitPermissionDecision(decision);
  return decisionToExitCode(decision);
}

// src/hooks/subagent-stop.ts
var log18 = createLogger("hook:subagent-stop");
function reviewerNameOf(agentType) {
  const t = agentType.replace(/^factory:/, "");
  switch (t) {
    case "implementation-reviewer":
      return "implementation";
    case "quality-reviewer":
      return "quality";
    case "silent-failure-hunter":
      return "silent-failure";
    case "systemic-failure-reviewer":
      return "systemic-failure";
    default:
      return null;
  }
}
function parseVerdict(lastMessage) {
  if (lastMessage == null || lastMessage.length === 0) {
    return PanelVerdictEnum.enum.blocked;
  }
  const m = lastMessage.match(/STATUS:\s+([A-Z_]+)/g);
  if (!m || m.length === 0) {
    return PanelVerdictEnum.enum.blocked;
  }
  const last = at(m, m.length - 1).replace(/STATUS:\s+/, "");
  return last === "DONE" ? PanelVerdictEnum.enum.approve : PanelVerdictEnum.enum.blocked;
}
function taskIdFromHeader(transcriptText) {
  if (transcriptText == null || transcriptText.length === 0) {
    return null;
  }
  const m = /\[task:([a-zA-Z0-9_-]+)\]/.exec(transcriptText);
  return m ? nonNull(m[1]) : null;
}
async function handleSubagentStop(input, deps = {}) {
  if (!input) {
    return null;
  }
  const agentType = input.agent_type ?? input.subagent_type ?? "";
  if (agentType.length === 0) {
    return null;
  }
  const reviewer = reviewerNameOf(agentType);
  if (reviewer === null) {
    return null;
  }
  const manager = deps.manager ?? new StateManager(deps);
  const sessionId = sessionIdOf(input);
  const run = sessionId !== void 0 ? await manager.findActiveByOwner(sessionId) : null;
  if (run === null) {
    if (sessionId !== void 0) {
      log18.warn(`no active run for session '${sessionId}' \u2014 reviewer '${reviewer}' result skipped`);
    }
    return null;
  }
  let taskId = deps.explicitTaskId ?? process.env.FACTORY_TASK_ID ?? "";
  if (taskId.length === 0) {
    const transcriptPath = input.agent_transcript_path ?? input.transcript_path;
    let transcriptText;
    if (transcriptPath != null && transcriptPath.length > 0 && deps.readTranscript) {
      try {
        transcriptText = await deps.readTranscript(transcriptPath);
      } catch (err) {
        log18.warn(
          `could not read transcript '${transcriptPath}': ${err.message} \u2014 falling back to last_assistant_message / single-reviewing-task resolution`
        );
        transcriptText = void 0;
      }
    }
    const fromHeader = taskIdFromHeader(transcriptText) ?? taskIdFromHeader(input.last_assistant_message);
    if (fromHeader != null) {
      taskId = fromHeader;
    }
  }
  if (taskId.length === 0) {
    const reviewing = Object.values(run.tasks).filter((t) => t.status === "reviewing");
    if (reviewing.length === 1) {
      taskId = at(reviewing, 0).task_id;
    }
  }
  if (taskId.length === 0) {
    log18.error(
      `could not resolve task_id for reviewer '${reviewer}' (run ${run.run_id}); verdict NOT persisted \u2014 orchestrator record is the single writer`
    );
    return null;
  }
  if (!run.tasks[taskId]) {
    log18.error(`resolved task_id '${taskId}' is not in run ${run.run_id}; reviewer '${reviewer}' result skipped`);
    return null;
  }
  const verdict = parseVerdict(input.last_assistant_message);
  log18.info(
    `reviewer '${reviewer}' on task '${taskId}': ${verdict} (observational \u2014 orchestrator records reviews via the drive --results record)`
  );
  return null;
}
async function runSubagentStop(_argv = [], deps = {}) {
  let input;
  try {
    const raw = deps.readRaw ? await deps.readRaw() : await readStdin();
    input = parseHookInput(raw);
  } catch (err) {
    log18.error(`malformed SubagentStop input: ${err.message}`);
    return EXIT.OK;
  }
  try {
    await handleSubagentStop(input, deps);
  } catch (err) {
    log18.error(`SubagentStop handler error: ${err.message}`);
  }
  return EXIT.OK;
}

// src/hooks/stop-gate.ts
var log19 = createLogger("hook:stop-gate");
var ALLOW = { kind: "allow" };
function decideStop(run, stoppingSession, stopHookActive = false) {
  if (run === null) {
    return ALLOW;
  }
  if (run.status !== "running") {
    return ALLOW;
  }
  if (run.debug) {
    return ALLOW;
  }
  if (run.owner_session !== void 0 && stoppingSession !== void 0 && stoppingSession !== run.owner_session) {
    return ALLOW;
  }
  const tasks = Object.values(run.tasks);
  const nonTerminal = tasks.filter((t) => !isTerminalTaskStatus(t.status));
  const pending = tasks.length === 0 || nonTerminal.length > 0;
  if (pending) {
    return ALLOW;
  }
  return stopHookActive ? { kind: "allow-unfinalized", run_id: run.run_id } : { kind: "block-finalize", run_id: run.run_id };
}
async function runStopGate(_argv = [], deps = {}) {
  const emit2 = deps.emit ?? ((s) => process.stdout.write(s));
  const manager = deps.manager ?? new StateManager(deps);
  let stoppingSession;
  let stopHookActive = false;
  try {
    const raw = deps.readRaw ? await deps.readRaw() : await readStdin();
    const input = parseHookInput(raw);
    stoppingSession = sessionIdOf(input);
    stopHookActive = input?.stop_hook_active === true;
  } catch (err) {
    log19.error(`Stop hook stdin unparseable (session-scoping skipped): ${err.message}`);
    stoppingSession = void 0;
  }
  let run;
  try {
    run = stoppingSession !== void 0 ? await manager.findActiveByOwner(stoppingSession) : null;
    if (run === null && stoppingSession !== void 0) {
      log19.warn(`Stop: session '${stoppingSession}' has no single attributed active run; passing through.`);
    }
  } catch (err) {
    const rawMsg = err.message.replace(/[\x00-\x1f]/g, " ").slice(0, 200);
    const reason = `could not enumerate run state: ${rawMsg}. Investigate the factory data directory before stopping.`;
    log19.error(reason);
    if (stopHookActive) {
      return EXIT.OK;
    }
    emitBlockDecision(deny(reason), emit2);
    return EXIT.OK;
  }
  const action = decideStop(run, stoppingSession, stopHookActive);
  if (action.kind === "block-finalize") {
    const reason = `run ${action.run_id}: all tasks are terminal but the run is not finalized. Run \`factory resume\` now to execute the real finalize (rollup PR, PRD close, report) \u2014 never flip run status by hand.`;
    log19.info(reason);
    emitBlockDecision(deny(reason), emit2);
    return EXIT.OK;
  }
  if (action.kind === "allow-unfinalized") {
    log19.info(
      `run ${action.run_id}: all tasks terminal but the run is not finalized \u2014 left running; \`factory resume\` will run the real finalize`
    );
  }
  return EXIT.OK;
}

// src/hooks/session-start.ts
var FACTORY_HARNESS_REMINDER = `<FACTORY_HARNESS_REMINDER>
You are the factory pipeline runner. Iron Laws:
1. Never decide a transition \u2014 the only next action is what the last envelope said.
2. Spawn exactly what the manifest says; collect output verbatim.
3. Fail loud \u2014 an unknown envelope kind or unexpected error means STOP and surface it.
Re-load skills/pipeline-runner/SKILL.md before taking any pipeline action.
</FACTORY_HARNESS_REMINDER>`;
function runSessionStart(_argv = [], deps = {}) {
  emitSessionStartContext(FACTORY_HARNESS_REMINDER, deps.emit);
  return EXIT.OK;
}

// src/hooks/main.ts
var hookRegistry = {
  "branch-protection": {
    describe: "PreToolUse Bash: block destructive git ops on protected branches",
    run: (argv) => runBranchProtection(argv)
  },
  "write-protection": {
    describe: "PreToolUse Edit|Write|MultiEdit: deny writes to hardcoded TCB paths (\u0394 W)",
    run: (argv) => runWriteProtection(argv)
  },
  "holdout-guard": {
    describe: "PreToolUse Read|Grep|Glob|Bash: deny reads of the holdout answer-key store (\u0394 Y)",
    run: (argv) => runHoldoutGuard(argv)
  },
  "secret-guard": {
    describe: "PreToolUse Bash: block git commit/push staging a known secret shape (\u0394 B)",
    run: (argv) => runSecretGuard(argv)
  },
  "pipeline-guards": {
    describe: "PreToolUse: test-writer scope + nested-shell + derive-don't-store ship gating (\u0394 V)",
    run: (argv) => runPipelineGuards(argv)
  },
  "subagent-stop": {
    describe: "SubagentStop: log a stopping reviewer's parsed verdict (observational \u2014 the orchestrator record is the single writer of task.reviewers[])",
    run: (argv) => runSubagentStop(argv)
  },
  "stop-gate": {
    describe: "Stop: one-shot block telling the session to `factory resume` an owned all-terminal unfinalized run (never mutates state); one-shot block on state corruption; stop_hook_active re-entries always allow",
    run: (argv) => runStopGate(argv)
  },
  "session-start": {
    describe: "SessionStart (compact): re-inject the runner Iron Laws + a pointer to reload the pipeline-runner skill",
    run: (argv) => runSessionStart(argv)
  }
};
function printHelp() {
  const names = Object.keys(hookRegistry).sort();
  const width = names.reduce((m, n) => Math.max(m, n.length), 0);
  const lines = [
    "factory-hook \u2014 factory plugin hook dispatcher",
    "",
    "Usage: factory-hook <hook-name> [args]",
    "",
    "Hooks:",
    ...names.map((n) => `  ${n.padEnd(width)}  ${nonNull(hookRegistry[n]).describe}`)
  ];
  process.stdout.write(lines.join("\n") + "\n");
}
async function dispatchHook(argv) {
  const [name, ...rest] = argv;
  if (name === void 0 || name === "--help" || name === "-h") {
    printHelp();
    return EXIT.OK;
  }
  const hook = hookRegistry[name];
  if (!hook) {
    process.stderr.write(`factory-hook: unknown hook '${name}'. Run \`factory-hook --help\` for the list.
`);
    return EXIT.USAGE;
  }
  return hook.run(rest);
}

// src/bin/factory-hook.ts
dispatchHook(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(detail + "\n");
  process.exit(EXIT.ERROR);
});
