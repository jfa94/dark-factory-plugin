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
        fs.lchmod = function(path7, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path7, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : (function(fs$rename) {
          function rename4(from, to, cb) {
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
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename4, fs$rename);
          return rename4;
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
        fs2.lchmod = function(path7, mode, callback) {
          fs2.open(
            path7,
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
        fs2.lchmodSync = function(path7, mode) {
          var fd = fs2.openSync(path7, constants.O_WRONLY | constants.O_SYMLINK, mode);
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
          fs2.lutimes = function(path7, at2, mt, cb) {
            fs2.open(path7, constants.O_SYMLINK, function(er, fd) {
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
          fs2.lutimesSync = function(path7, at2, mt) {
            var fd = fs2.openSync(path7, constants.O_SYMLINK);
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
      function ReadStream(path7, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path7, options);
        Stream.call(this);
        var self = this;
        this.path = path7;
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
      function WriteStream(path7, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path7, options);
        Stream.call(this);
        this.path = path7;
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
      fs2.readFile = readFile22;
      function readFile22(path7, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path7, options, cb);
        function go$readFile(path8, options2, cb2, startTime) {
          return fs$readFile(path8, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path8, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile6;
      function writeFile6(path7, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path7, data, options, cb);
        function go$writeFile(path8, data2, options2, cb2, startTime) {
          return fs$writeFile(path8, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path8, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile2;
      function appendFile2(path7, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path7, data, options, cb);
        function go$appendFile(path8, data2, options2, cb2, startTime) {
          return fs$appendFile(path8, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path8, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile2;
      function copyFile2(src, dest, flags, cb) {
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
      fs2.readdir = readdir4;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir4(path7, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path8, options2, cb2, startTime) {
          return fs$readdir(path8, fs$readdirCallback(
            path8,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path8, options2, cb2, startTime) {
          return fs$readdir(path8, options2, fs$readdirCallback(
            path8,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path7, options, cb);
        function fs$readdirCallback(path8, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path8, options2, cb2],
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
      function ReadStream(path7, options) {
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
      function WriteStream(path7, options) {
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
      function createReadStream(path7, options) {
        return new fs2.ReadStream(path7, options);
      }
      function createWriteStream(path7, options) {
        return new fs2.WriteStream(path7, options);
      }
      var fs$open = fs2.open;
      fs2.open = open2;
      function open2(path7, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path7, flags, mode, cb);
        function go$open(path8, flags2, mode2, cb2, startTime) {
          return fs$open(path8, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path8, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
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
        return fs.stat(file, (err, stat2) => {
          if (err) {
            return callback(err);
          }
          callback(null, stat2.mtime, cachedPrecision);
        });
      }
      const mtime = new Date(Math.ceil(Date.now() / 1e3) * 1e3 + 5);
      fs.utimes(file, mtime, mtime, (err) => {
        if (err) {
          return callback(err);
        }
        fs.stat(file, (err2, stat2) => {
          if (err2) {
            return callback(err2);
          }
          const precision = stat2.mtime.getTime() % 1e3 === 0 ? "s" : "ms";
          Object.defineProperty(fs, cacheSymbol, { value: precision });
          callback(null, stat2.mtime, precision);
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
    var path7 = __require("path");
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
        return callback(null, path7.resolve(file));
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
        options.fs.stat(lockfilePath, (err2, stat2) => {
          if (err2) {
            if (err2.code === "ENOENT") {
              return acquireLock(file, { ...options, stale: 0 }, callback);
            }
            return callback(err2);
          }
          if (!isLockStale(stat2, options)) {
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
    function isLockStale(stat2, options) {
      return stat2.mtime.getTime() < Date.now() - options.stale;
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
        options.fs.stat(lock3.lockfilePath, (err, stat2) => {
          const isOverThreshold = lock3.lastUpdate + options.stale < Date.now();
          if (err) {
            if (err.code === "ENOENT" || isOverThreshold) {
              return setLockAsCompromised(file, lock3, Object.assign(err, { code: "ECOMPROMISED" }));
            }
            lock3.updateDelay = 1e3;
            return updateLock(file, options);
          }
          const isMtimeOurs = lock3.mtime.getTime() === stat2.mtime.getTime();
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
        options.fs.stat(getLockFile(file2, options), (err2, stat2) => {
          if (err2) {
            return err2.code === "ENOENT" ? callback(null, false) : callback(err2);
          }
          return callback(null, !isLockStale(stat2, options));
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
      return (...args) => new Promise((resolve3, reject) => {
        args.push((err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve3(result);
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

// src/config/load.ts
import { existsSync as existsSync3, readFileSync } from "node:fs";
import { basename as basename2, dirname as dirname3, join as join2, resolve as resolve2, sep as sep2 } from "node:path";
import { homedir } from "node:os";

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

// src/shared/json.ts
import { readFile } from "node:fs/promises";

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
  constructor(message, path7, cause) {
    super(message);
    this.name = "JsonParseError";
    this.path = path7;
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
async function readJsonFile(path7) {
  return parseJson(await readFile(path7, "utf8"), path7);
}
function stringifyJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}
async function writeJsonFile(path7, value) {
  await atomicWriteFile(path7, stringifyJson(value));
}

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
  const { data, path: path7, errorMaps, issueData } = params;
  const fullPath = [...path7, ...issueData.path || []];
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
  constructor(parent, value, path7, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path7;
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

// src/shared/exec.ts
import { spawn } from "node:child_process";
var DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
function exec(command, args = [], opts = {}) {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise((resolve3, reject) => {
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
      resolve3({
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

// src/shared/jsonl.ts
import { appendFile, mkdir as mkdir2, readFile as readFile2 } from "node:fs/promises";

// src/shared/fs-errors.ts
function isEnoent(err) {
  return err instanceof Error && err.code === "ENOENT";
}

// src/shared/jsonl.ts
import { dirname as dirname2 } from "node:path";

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
function getOrThrow(m, k, msg) {
  return nonNull(m.get(k), msg ?? "missing map key");
}

// src/shared/jsonl.ts
async function appendJsonl(path7, record) {
  await mkdir2(dirname2(path7), { recursive: true });
  await appendFile(path7, JSON.stringify(record) + "\n", "utf8");
}
async function readJsonl(path7) {
  let text;
  try {
    text = await readFile2(path7, "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      return [];
    }
    throw err;
  }
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = at(lines, i).trim();
    if (line.length === 0) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch (cause) {
      throw new JsonParseError(`invalid JSONL at ${path7}:${i + 1}: ${cause.message}`, path7, cause);
    }
  }
  return out;
}

// src/shared/time.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function nowEpoch() {
  return Math.floor(Date.now() / 1e3);
}
function epochToIso(epochSeconds) {
  return new Date(epochSeconds * 1e3).toISOString();
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
var REDACTION_TOKEN = "[REDACTED]";
function redactSecrets(text) {
  if (SECRET_REDACTION_PATTERNS.length === 0) {
    return text;
  }
  const combined = SECRET_REDACTION_PATTERNS.map((p) => p.source).join("|");
  const re = new RegExp(combined, "g");
  return text.replace(re, REDACTION_TOKEN);
}
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

// src/shared/ids.ts
var ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
var SLUG_MAX_LENGTH = 50;
function validateId(id, label = "id") {
  if (id.length === 0) {
    throw new Error(`${label}: empty`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`${label}: invalid (must match ${ID_PATTERN.source}): ${id}`);
  }
  return id;
}
function makeRunId(now = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const time = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `run-${date}-${time}`;
}
function slugify(input) {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "").slice(0, SLUG_MAX_LENGTH);
}

// src/shared/paths.ts
function tildeShorten(absPath, home) {
  if (home.length === 0) {
    return absPath;
  }
  if (absPath === home) {
    return "~";
  }
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  if (absPath.startsWith(base + "/")) {
    return "~" + absPath.slice(base.length);
  }
  return absPath;
}

// src/shared/file-lock.ts
var import_proper_lockfile = __toESM(require_proper_lockfile(), 1);
import { mkdir as mkdir3 } from "node:fs/promises";
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
    await mkdir3(opts.dir, { recursive: true });
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
import { access } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";
async function pathExists(absPath) {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}
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
var log3 = createLogger("config");
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
  const pluginFromPath = basename2(dirname3(pluginRoot));
  const marketplaceFromPath = basename2(dirname3(dirname3(pluginRoot)));
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
      dir = dirname3(dir);
    }
    return resolve2(here, "..");
  } catch (err) {
    log3.debug(`inferPluginRoot: ${err.message}; falling back to cwd`);
    return process.cwd();
  }
}
function resolvePluginRoot(env = process.env) {
  const fromEnv = env.CLAUDE_PLUGIN_ROOT;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return resolve2(fromEnv);
  }
  return inferPluginRoot();
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
    log3.warn(m);
  });
  const notifyRedirect = opts.warn ?? ((m) => {
    log3.debug(m);
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
function configPath(dataDir) {
  return join2(dataDir, "config.json");
}
function loadConfig(opts = {}) {
  let dataDir;
  try {
    dataDir = resolveDataDir(opts);
  } catch {
    return ConfigSchema.parse({});
  }
  const file = configPath(dataDir);
  if (!existsSync3(file)) {
    return ConfigSchema.parse({});
  }
  const raw = parseJson(readFileSync(file, "utf8"), file);
  warnRetiredKeys(raw, file);
  return ConfigSchema.parse(raw);
}
var RETIRED_KEYS = [
  ["git", "stagingBranch"],
  ["e2e", "testDir"]
];
var retiredKeyWarned = /* @__PURE__ */ new Set();
function warnRetiredKeys(raw, file) {
  if (typeof raw !== "object" || raw === null) {
    return;
  }
  for (const [section, key] of RETIRED_KEYS) {
    const sectionVal = raw[section];
    if (typeof sectionVal === "object" && sectionVal !== null && key in sectionVal) {
      const id = `${file}:${section}.${key}`;
      if (!retiredKeyWarned.has(id)) {
        retiredKeyWarned.add(id);
        log3.warn(
          `config: '${section}.${key}' is retired and ignored (${file}) \u2014 remove it (factory configure --unset ${section}.${key})`
        );
      }
    }
  }
}

// src/config/save.ts
import { existsSync as existsSync4, readFileSync as readFileSync2 } from "node:fs";
import { mkdir as mkdir4 } from "node:fs/promises";
function readRawConfig(opts = {}) {
  const file = configPath(resolveDataDir(opts));
  if (!existsSync4(file)) {
    return {};
  }
  const parsed = parseJson(readFileSync2(file, "utf8"), file);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config: ${file} is not a JSON object`);
  }
  return parsed;
}
async function saveRawConfig(raw, opts = {}) {
  const resolved = ConfigSchema.parse(raw);
  const dataDir = resolveDataDir(opts);
  await mkdir4(dataDir, { recursive: true });
  await atomicWriteFile(configPath(dataDir), stringifyJson(raw));
  return resolved;
}
function parseSetToken(token) {
  const eq = token.indexOf("=");
  if (eq <= 0) {
    throw new Error(`configure: --set expects 'key.path=value', got '${token}'`);
  }
  const path7 = splitPath(token.slice(0, eq));
  const rawValue = token.slice(eq + 1);
  return { path: path7, value: coerceValue(rawValue) };
}
function coerceValue(raw) {
  try {
    return parseJson(raw);
  } catch {
    return raw;
  }
}
function splitPath(dotted) {
  const path7 = dotted.split(".");
  if (path7.length === 0 || path7.some((s) => s.length === 0)) {
    throw new Error(`configure: invalid key path '${dotted}'`);
  }
  return path7;
}
function setAtPath(obj, path7, value) {
  const next = structuredClone(obj);
  let cursor = next;
  for (let i = 0; i < path7.length - 1; i++) {
    const key = at(path7, i);
    const existing = cursor[key];
    if (existing === void 0 || existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[at(path7, path7.length - 1)] = value;
  return next;
}
function unsetAtPath(obj, path7) {
  const next = structuredClone(obj);
  const parents = [];
  let cursor = next;
  for (let i = 0; i < path7.length - 1; i++) {
    const key = at(path7, i);
    const child = cursor[key];
    if (child === void 0 || child === null || typeof child !== "object" || Array.isArray(child)) {
      return next;
    }
    parents.push({ container: cursor, key });
    cursor = child;
  }
  Reflect.deleteProperty(cursor, at(path7, path7.length - 1));
  for (let i = parents.length - 1; i >= 0; i--) {
    const { container, key } = at(parents, i);
    const child = container[key];
    if (Object.keys(child).length === 0) {
      Reflect.deleteProperty(container, key);
    } else {
      break;
    }
  }
  return next;
}
function getAtPath(config, path7) {
  let cursor = config;
  for (const key of path7) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      throw new Error(`configure: '${path7.join(".")}' has no value (not an object at '${key}')`);
    }
    if (!(key in cursor)) {
      throw new Error(`configure: unknown config key '${path7.join(".")}'`);
    }
    cursor = cursor[key];
  }
  return cursor;
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
function refineRunCrossFields(run9, ctx) {
  if (run9.quota != null) {
    const wanted = run9.quota.binding_window === "5h" ? "paused" : "suspended";
    if (run9.status !== wanted) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["quota"],
        message: `run '${run9.run_id}' carries a '${run9.quota.binding_window}' quota checkpoint but status is '${run9.status}' (a '${run9.quota.binding_window}' checkpoint pairs with '${wanted}')`
      });
    }
  }
  if (isTerminalRunStatus(run9.status) !== (run9.ended_at != null)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["ended_at"],
      message: isTerminalRunStatus(run9.status) ? `run '${run9.run_id}' is terminal ('${run9.status}') but has no ended_at` : `run '${run9.run_id}' is '${run9.status}' (non-terminal) but carries ended_at`
    });
  }
  if (run9.terminal_reason !== void 0 && run9.status !== "failed" && run9.status !== "superseded") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["terminal_reason"],
      message: `run '${run9.run_id}' is '${run9.status}' but carries terminal_reason (only failed|superseded may)`
    });
  }
  if (run9.docs !== void 0) {
    reasonIffFailed(ctx, {
      runId: run9.run_id,
      path: ["docs", "reason"],
      label: "docs phase",
      status: run9.docs.status,
      reason: run9.docs.reason
    });
  }
  if (run9.traceability !== void 0) {
    reasonIffFailed(ctx, {
      runId: run9.run_id,
      path: ["traceability", "reason"],
      label: "traceability phase",
      status: run9.traceability.status,
      reason: run9.traceability.reason
    });
    if (run9.traceability.status === "done" && run9.traceability.verdicts.some((v) => v.verdict === "unmet")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["traceability", "verdicts"],
        message: `run '${run9.run_id}' traceability phase is 'done' but carries an 'unmet' verdict (unmet must record as failed)`
      });
    }
  }
  if (run9.e2e_phase?.status !== void 0) {
    const isFailed = run9.e2e_phase.status === "failed";
    reasonIffFailed(ctx, {
      runId: run9.run_id,
      path: ["e2e_phase", "reason"],
      label: "e2e phase",
      status: run9.e2e_phase.status,
      reason: run9.e2e_phase.reason
    });
    const hasAdvisory = run9.e2e_phase.advisory != null && run9.e2e_phase.advisory.length > 0;
    if (isFailed && hasAdvisory) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["e2e_phase", "advisory"],
        message: `run '${run9.run_id}' e2e phase is 'failed' but carries an advisory (advisory is the done-side counterpart of reason, never set on failed)`
      });
    }
  }
  if (run9.e2e_assessment?.status !== void 0) {
    reasonIffFailed(ctx, {
      runId: run9.run_id,
      path: ["e2e_assessment", "reason"],
      label: "e2e assessment",
      status: run9.e2e_assessment.status,
      reason: run9.e2e_assessment.reason
    });
  }
  for (const [k, value] of Object.entries(run9.tasks)) {
    if (k !== value.task_id) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["tasks", k, "task_id"],
        message: `tasks map key '${k}' does not match row task_id '${value.task_id}'`
      });
    }
  }
  run9.misses.forEach((e, i) => {
    if (run9.tasks[e.task_id] === void 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["misses", i, "task_id"],
        message: `miss-ledger references task '${e.task_id}' which is not in run '${run9.run_id}'`
      });
    }
  });
}
var RunStateChecked = RunStateSchema.superRefine(refineRunCrossFields);
function parseRunState(raw) {
  return RunStateChecked.parse(raw);
}

// src/core/state/seed.ts
function seedTaskRows(specTasks, ctx, idOf = (id) => id) {
  const ids = new Set(specTasks.map((t) => idOf(t.task_id)));
  const tasks = {};
  for (const t of specTasks) {
    const id = idOf(t.task_id);
    validateId(id, "task-id");
    if (tasks[id] !== void 0) {
      throw new Error(`${ctx.context}: duplicate task id '${t.task_id}' in ${ctx.specLabel}`);
    }
    const dependsOn = t.depends_on.map(idOf);
    for (const [i, dep] of dependsOn.entries()) {
      if (dep === id) {
        throw new Error(`${ctx.context}: task '${t.task_id}' depends on itself in ${ctx.specLabel}`);
      }
      if (!ids.has(dep)) {
        throw new Error(
          `${ctx.context}: task '${t.task_id}' depends on unknown task '${t.depends_on[i]}' in ${ctx.specLabel}`
        );
      }
    }
    tasks[id] = {
      task_id: id,
      status: "pending",
      // Frozen denormalization of the spec DAG edges for hot traversal (next.ts,
      // rescue/scan.ts); integrity pinned by the dangling/self/cyclic/duplicate
      // checks in this module. The risk_tier dial is NOT copied — it is read live
      // from the SpecTask via specTaskOf (derive-don't-store, Decision 25).
      depends_on: dependsOn,
      escalation_rung: 0,
      reviewers: [],
      merge_resyncs: 0
    };
  }
  return tasks;
}
function assertAcyclic(tasks, ctx) {
  const VISITING = 1;
  const DONE = 2;
  const state = /* @__PURE__ */ new Map();
  const visit = (id, trail) => {
    const mark = state.get(id);
    if (mark === DONE) {
      return;
    }
    if (mark === VISITING) {
      throw new Error(`${ctx.context}: dependency cycle in ${ctx.specLabel}: ${[...trail, id].join(" \u2192 ")}`);
    }
    state.set(id, VISITING);
    for (const dep of tasks[id]?.depends_on ?? []) {
      visit(dep, [...trail, id]);
    }
    state.set(id, DONE);
  };
  for (const id of Object.keys(tasks)) {
    visit(id, []);
  }
}

// src/core/state/derive.ts
function mkVerdict(passed, gate, from) {
  return { passed, gate, __derived: true, from };
}
function deriveAllGatesVerdict(evidence) {
  const passed = evidence.length > 0 && evidence.every((e) => e.observed);
  return mkVerdict(passed, "all", [...evidence]);
}
function derivePanelVerdict(reviewersOrTask) {
  const reviewers = Array.isArray(reviewersOrTask) ? reviewersOrTask : reviewersOrTask.reviewers;
  const passed = reviewers.length > 0 && reviewers.every((r) => r.verdict === "approve");
  return mkVerdict(
    passed,
    "panel",
    reviewers.map((r) => ({
      gate: `panel:${r.reviewer}`,
      observed: r.verdict === "approve",
      detail: `verdict=${r.verdict} confirmed_blockers=${r.confirmed_blockers}`
    }))
  );
}
function deriveMergeGateVerdict(task, gateEvidence) {
  const det = deriveAllGatesVerdict(gateEvidence);
  const panel = derivePanelVerdict(task);
  return mkVerdict(det.passed && panel.passed, "merge-gate", [...det.from, ...panel.from]);
}
function mergeGateBlockReason(reviewers, gateEvidence) {
  const parts = [];
  if (gateEvidence.length === 0) {
    parts.push("no deterministic gate evidence");
  } else {
    const failed = gateEvidence.filter((g) => !g.observed);
    if (failed.length > 0) {
      const named = failed.map(
        (g) => g.detail != null && g.detail.length > 0 ? `${g.gate} (${g.detail})` : g.gate
      );
      parts.push(`failed gates: ${named.join(", ")}`);
    }
  }
  const blocked = reviewers.filter((r) => r.verdict === "blocked").map((r) => r.reviewer);
  const errored = reviewers.filter((r) => r.verdict === "error").map((r) => r.reviewer);
  if (blocked.length > 0) {
    parts.push(`blocked by: ${blocked.join(", ")}`);
  }
  if (errored.length > 0) {
    parts.push(`unresolved (verifier error): ${errored.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("; ") : "merge gate not unanimous";
}

// src/core/state/manager.ts
import { mkdir as mkdir5, readFile as readFile3, readdir, readlink, rename as rename2, rm, symlink, unlink as unlink2 } from "node:fs/promises";
import { existsSync as existsSync5 } from "node:fs";
import { basename as basename3, dirname as dirname4, join as join4 } from "node:path";

// src/core/state/paths.ts
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";
var SPECS_DIR = "specs";
var SPEC_BUILD_DIR = "spec-build";
var DOCS_FACTORY_DIR = "factory";
var RUNS_DIR = "runs";
var CURRENT_LINK = "current";
var CURRENT_DIR = "current";
var STATE_FILE = "state.json";
var METRICS_FILE = "metrics.jsonl";
var REPORT_FILE = "report.md";
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
function runMetricsPath(dataDir, runId) {
  return join3(runDir(dataDir, runId), METRICS_FILE);
}
function runReportPath(dataDir, runId) {
  return join3(runDir(dataDir, runId), REPORT_FILE);
}
function runCoverageDir(dataDir, runId) {
  return join3(runDir(dataDir, runId), "coverage");
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
function docsFactoryDir(docsRoot, specId) {
  validateId(specId, "spec-id");
  return join3(docsRoot, DOCS_FACTORY_DIR, specId);
}
var SPEC_BUILD_TMP_NAMESPACE = "factory-spec-build";
function defaultSpecBuildRoot() {
  return join3(tmpdir(), SPEC_BUILD_TMP_NAMESPACE);
}
function specBuildRoot(root) {
  return join3(root, SPEC_BUILD_DIR);
}
function specBuildDir(root, repo, issueNumber) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`specBuildDir: issue number must be a positive integer, got ${issueNumber}`);
  }
  return join3(specBuildRoot(root), repoKey(repo), String(issueNumber));
}

// src/core/state/manager.ts
var log4 = createLogger("state");
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
    if (existsSync5(this.statePath(args.run_id))) {
      throw new Error(`state: run '${args.run_id}' already exists`);
    }
    await mkdir5(join4(dir, "holdouts"), { recursive: true });
    await mkdir5(join4(dir, "reviews"), { recursive: true });
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
      if (existsSync5(this.statePath(args.run_id))) {
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
    const path7 = this.statePath(runId);
    const raw = await readFile3(path7, "utf8");
    return _StateManager.guardedParse(parseJson(raw, path7), path7);
  }
  /**
   * True iff a RunState exists on disk for this run id. Synchronous,
   * no read/parse — mirrors the existence check `create()` already uses
   * internally before writing. Lets a caller distinguish "no run was ever
   * created" from a genuine read failure without parsing.
   */
  exists(runId) {
    return existsSync5(this.statePath(runId));
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
    if (!existsSync5(link)) {
      return null;
    }
    const statePath = join4(link, "state.json");
    let raw;
    try {
      raw = await readFile3(statePath, "utf8");
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
        log4.warn(`state: skipping unreadable run '${name}': ${err.message}`);
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
        raw = await readFile3(runStatePath(this.dataDir, name), "utf8");
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
      log4.warn(
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
      await mkdir5(dirname4(link), { recursive: true });
      await unlink2(tmp).catch(() => {
      });
      await symlink(target, tmp);
      await rm(link, { force: true, recursive: false }).catch(() => {
      });
      await rename2(tmp, link);
    } catch (err) {
      log4.warn(`state: could not update current pointer '${link}' \u2192 '${target}': ${err.message}`);
      await unlink2(tmp).catch(() => {
      });
    }
  }
};

// src/cli/args.ts
function parseArgs(argv, opts = {}) {
  const booleans = /* @__PURE__ */ new Set(["help", "h", ...opts.booleans ?? []]);
  const positionals = [];
  const values = /* @__PURE__ */ new Map();
  const push = (name, value) => {
    const list = values.get(name) ?? [];
    list.push(value);
    values.set(name, list);
  };
  let i = 0;
  let optionsEnded = false;
  while (i < argv.length) {
    const tok = at(argv, i);
    if (optionsEnded || !tok.startsWith("-")) {
      positionals.push(tok);
      i += 1;
      continue;
    }
    if (tok === "--") {
      optionsEnded = true;
      i += 1;
      continue;
    }
    const dashless = tok.replace(/^-+/, "");
    const eq = dashless.indexOf("=");
    if (eq >= 0) {
      push(dashless.slice(0, eq), dashless.slice(eq + 1));
      i += 1;
      continue;
    }
    if (booleans.has(dashless)) {
      push(dashless, true);
      i += 1;
      continue;
    }
    const next = argv[i + 1];
    if (next === void 0 || next.startsWith("-") && next !== "-") {
      push(dashless, true);
      i += 1;
    } else {
      push(dashless, next);
      i += 2;
    }
  }
  const lastOf = (name) => {
    const list = values.get(name);
    return list === void 0 ? void 0 : list[list.length - 1];
  };
  return {
    positionals,
    flag: lastOf,
    all: (name) => (values.get(name) ?? []).map(String),
    has: (name) => values.has(name),
    requireFlag(name) {
      const v = lastOf(name);
      if (typeof v !== "string" || v.length === 0) {
        throw new UsageError(`missing required --${name}`);
      }
      return v;
    }
  };
}
function parseShipMode(raw) {
  if (raw === void 0) {
    return void 0;
  }
  const parsed = ShipModeEnum.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  throw new UsageError(`unknown --ship-mode '${String(raw)}' (expected ${ShipModeEnum.options.join(" | ")})`);
}
function optionalString(raw) {
  return typeof raw === "string" && raw.length > 0 ? raw : void 0;
}
async function parseResultsFlag(args, parse) {
  const path7 = args.flag("results");
  if (typeof path7 === "string" && path7.length > 0) {
    try {
      return await parse(path7);
    } catch (err) {
      throw new UsageError(`--results ${path7}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (path7 !== void 0) {
    throw new UsageError("--results requires a file path");
  }
  return void 0;
}

// src/cli/io.ts
function emitJson(value) {
  process.stdout.write(stringifyJson(value) + "\n");
}
function emitLine(line) {
  process.stdout.write(line + "\n");
}
function emitHelp(text) {
  emitLine(text);
  return EXIT.OK;
}
function emitError(line) {
  process.stderr.write(line + "\n");
}

// src/cli/registry-types.ts
function withUsageGuard(prefix, fn) {
  return async (argv) => {
    try {
      return await fn(argv);
    } catch (err) {
      if (isUsageError(err)) {
        emitError(`${prefix}: ${err.message}`);
        return EXIT.USAGE;
      }
      throw err;
    }
  };
}

// src/cli/subcommands/configure.ts
var HELP = `factory configure \u2014 inspect or edit the config overlay

Usage:
  factory configure                         Print the resolved config as JSON
  factory configure --get <key.path>        Print one resolved value as JSON
  factory configure --set <key.path=value>  Set a value (repeatable), persist, print result
  factory configure --unset <key.path>      Revert a key to its default (repeatable)

Values parse as JSON when possible (numbers, booleans, arrays); otherwise as a
bare string. Examples:
  factory configure --set quality.holdoutPercent=25
  factory configure --set git.baseBranch=develop
  factory configure --set git.autoProvision=true`;
async function run(argv) {
  const args = parseArgs(argv);
  if (args.flag("help") === true) {
    return emitHelp(HELP);
  }
  const sets = args.all("set");
  const unsets = args.all("unset");
  const getKey = args.flag("get");
  if (typeof getKey === "string") {
    if (sets.length > 0 || unsets.length > 0) {
      throw new UsageError("--get cannot be combined with --set/--unset");
    }
    emitJson(getAtPath(loadConfig(), splitPath(getKey)));
    return EXIT.OK;
  }
  if (sets.length === 0 && unsets.length === 0) {
    emitJson(loadConfig());
    return EXIT.OK;
  }
  let raw = readRawConfig();
  for (const token of sets) {
    const { path: path7, value } = parseSetToken(token);
    raw = setAtPath(raw, path7, value);
  }
  for (const token of unsets) {
    raw = unsetAtPath(raw, splitPath(token));
  }
  const resolved = await saveRawConfig(raw);
  emitJson(resolved);
  return EXIT.OK;
}
var configureCommand = {
  describe: "Inspect or edit the persisted config (--get/--set/--unset)",
  run: withUsageGuard("configure", run)
};

// src/cli/subcommands/debug.ts
import { join as join26 } from "node:path";

// src/core/phase-machine/phases.ts
var TaskPhaseEnum = external_exports.enum(TASK_PHASES);
var RunPhaseEnum = external_exports.enum(["finalize"]);
var TASK_PHASE_ORDER = TASK_PHASES;
function nextPhase(s) {
  const i = TASK_PHASE_ORDER.indexOf(s);
  if (i < 0) {
    throw new Error(`nextPhase: '${s}' is not a known task phase`);
  }
  const next = TASK_PHASE_ORDER[i + 1];
  return next ?? null;
}
function phaseToInFlightStatus(s) {
  switch (s) {
    case "preflight":
      return TaskStatusEnum.enum.pending;
    case "tests":
      return TaskStatusEnum.enum.executing;
    case "exec":
      return TaskStatusEnum.enum.executing;
    case "verify":
      return TaskStatusEnum.enum.reviewing;
    case "ship":
      return TaskStatusEnum.enum.shipping;
  }
}

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
var AGENT_TYPE_BY_ROLE = {
  "test-writer": "test-writer",
  implementer: "implementer",
  "implementation-reviewer": "implementation-reviewer",
  "quality-reviewer": "quality-reviewer",
  "silent-failure-hunter": "silent-failure-hunter",
  "systemic-failure-reviewer": "systemic-failure-reviewer",
  "database-design-reviewer": "database-design-reviewer",
  scribe: "scribe"
};
var GENERAL_PURPOSE_AGENT_TYPE = "general-purpose";
var E2E_AUTHOR_AGENT_TYPE = "e2e-author";
var E2E_ASSESSOR_AGENT_TYPE = "e2e-assessor";
var TRACEABILITY_AUDITOR_AGENT_TYPE = "traceability-auditor";
var SPEC_GENERATOR_AGENT_TYPE = "spec-generator";
var SPEC_REVIEWER_AGENT_TYPE = "spec-reviewer";
var FINDING_VERIFIER_AGENT_TYPE = "finding-verifier";
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
function parseSpawnRequest(raw) {
  return SpawnRequestSchema.parse(raw);
}

// src/core/phase-machine/result.ts
function assertNever(x) {
  throw new Error(`assertNever: unhandled value ${JSON.stringify(x)} \u2014 a PhaseResult.kind was not handled`);
}
function advance(to) {
  return { kind: "advance", to };
}
function spawn2(request) {
  return { kind: "spawn-agents", request };
}
function waitRetry(phase, reason, attempt, max_attempts) {
  if (attempt > max_attempts) {
    throw new Error(
      `waitRetry: wait-retry for phase '${phase}' exceeded max_attempts (${attempt} > ${max_attempts})`
    );
  }
  return { kind: "wait-retry", phase, reason, attempt, max_attempts };
}
function taskDone() {
  return { kind: "task-terminal", outcome: { outcome: "done" } };
}
function taskFailed(failure_class, reason) {
  return {
    kind: "task-terminal",
    outcome: { outcome: "failed", failure_class, reason }
  };
}
function finalizeTerminal(run_status) {
  return { kind: "finalize-terminal", run_status };
}

// src/core/phase-machine/engine.ts
async function runPhase(phase, ctx, handlers) {
  const result = await dispatch(phase, ctx, handlers);
  return checkResult(phase, result);
}
async function dispatch(phase, ctx, handlers) {
  const runParsed = RunPhaseEnum.safeParse(phase);
  if (runParsed.success) {
    const runPhaseName = runParsed.data;
    switch (runPhaseName) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exhaustive switch over a currently-single-member enum; the assertNever default is intentional future-proofing (a new RunPhase member becomes a compile break here, not a silent mis-route)
      case "finalize":
        return handlers.finalize(ctx);
      default:
        return assertNever(runPhaseName);
    }
  }
  const parsed = TaskPhaseEnum.safeParse(phase);
  if (!parsed.success) {
    throw new Error(`runPhase: unknown phase ''`);
  }
  const taskPhase = parsed.data;
  switch (taskPhase) {
    case "preflight":
      return handlers.preflight(ctx);
    case "tests":
      return handlers.tests(ctx);
    case "exec":
      return handlers.exec(ctx);
    case "verify":
      return handlers.verify(ctx);
    case "ship":
      return handlers.ship(ctx);
    default:
      return assertNever(taskPhase);
  }
}
function checkResult(phase, result) {
  if (RunPhaseEnum.safeParse(phase).success) {
    if (result.kind !== "finalize-terminal") {
      throw new Error(
        `runPhase: run-level phase '' returned '${result.kind}' \u2014 finalize is terminal and must return only 'finalize-terminal' (it must never spin)`
      );
    }
    return result;
  }
  switch (result.kind) {
    case "advance":
    case "spawn-agents":
    case "graceful-stop":
    case "task-terminal":
      return result;
    case "wait-retry": {
      if (result.attempt > result.max_attempts) {
        throw new Error(
          `runPhase: wait-retry for phase '${result.phase}' exceeded max_attempts (${result.attempt} > ${result.max_attempts}); caller must classify a fail (reason: ${result.reason})`
        );
      }
      return result;
    }
    case "finalize-terminal":
      throw new Error(
        `runPhase: per-task phase '' returned 'finalize-terminal' \u2014 that result is reserved for the run-level finalize phase`
      );
    default:
      return assertNever(result);
  }
}
function decideFinalize(run9) {
  const tasks = Object.values(run9.tasks);
  const nonTerminal = tasks.filter((t) => !isTerminalTaskStatus(t.status));
  if (nonTerminal.length > 0) {
    const ids = nonTerminal.map((t) => `${t.task_id}=${t.status}`).join(", ");
    throw new Error(
      `decideFinalize: ${nonTerminal.length} non-terminal task(s) remain [${ids}] \u2014 finalize is terminal and must not be called with in-flight work (would spin in bash)`
    );
  }
  const allDone = tasks.length > 0 && tasks.every((t) => t.status === "done");
  return finalizeTerminal(allDone ? "completed" : "failed");
}

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
import { dirname as dirname5 } from "node:path";
var log5 = createLogger("git");
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
    log5.debug(`checkout -B ${branch} ${startPoint}`);
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
    return dirname5(r.stdout.trim());
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
  async worktreeExists(path7, opts) {
    const r = await this.execOrThrow(["worktree", "list", "--porcelain"], opts);
    return r.stdout.split("\n").some((line) => line === `worktree ${path7}`);
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
    log5.debug(`merge --no-edit ${ref} into ${branch}`);
    await this.execOrThrow(["checkout", branch], opts);
    await this.execOrThrow(["merge", "--no-edit", ref], opts);
  }
  async tryMergeNoForce(branch, ref, opts) {
    const mergeArgs = opts?.message !== void 0 ? ["merge", "-m", opts.message, ref] : ["merge", "--no-edit", ref];
    log5.debug(`tryMerge ${mergeArgs.slice(1).join(" ")} into ${branch}`);
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
    log5.debug(`reset --hard ${ref} && clean -fd`);
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
  let path7;
  const scp = /^[^/@]+@[^/:]+:(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes("://")) {
    path7 = scp[1];
  } else {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.+)$/.exec(trimmed);
    if (withScheme) {
      const afterScheme = nonNull(withScheme[1]);
      const firstSlash = afterScheme.indexOf("/");
      if (firstSlash >= 0) {
        path7 = afterScheme.slice(firstSlash + 1);
      }
    }
  }
  if (path7 === void 0) {
    return null;
  }
  let p = path7.replace(/\/+$/, "");
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
function splitRepoSlug(slug) {
  const parts = validateRepoSlug(slug).split("/");
  return { owner: at(parts, 0), repo: at(parts, 1) };
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
var log6 = createLogger("gh");
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
function aggregateChecks(rows) {
  if (rows.length === 0) {
    return "none";
  }
  const buckets = rows.map((r) => (r.bucket ?? "").toLowerCase());
  if (buckets.some((b) => b === "fail" || b === "cancel")) {
    return "failing";
  }
  if (buckets.some((b) => b === "pending")) {
    return "pending";
  }
  return "passing";
}
var GhChecksSchema = external_exports.array(external_exports.object({ bucket: external_exports.string().optional() }));
var GhProtectionSchema = external_exports.object({
  required_status_checks: external_exports.object({ strict: external_exports.boolean().optional(), contexts: external_exports.array(external_exports.string()).optional() }).nullish()
});
var GhRulesSchema = external_exports.array(external_exports.object({ type: external_exports.string().optional() }));
function parseGhJson(result, schema, where) {
  if (result.truncated) {
    throw new Error(
      `gh: output of '${where}' was TRUNCATED (hit maxBuffer) \u2014 refusing to parse a clipped JSON payload`
    );
  }
  const raw = parseJson(result.stdout, where);
  return schema.parse(raw);
}
function ghApiFailure(path7, r) {
  return new Error(`gh api ${path7} failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
}
var DefaultGhClient = class {
  runner;
  constructor(runner = defaultGhRunner) {
    this.runner = runner;
  }
  execOpts(opts) {
    const cwd = opts?.cwd;
    return cwd != null && cwd.length > 0 ? { cwd } : {};
  }
  async prList(args, opts) {
    const argv = [
      "pr",
      "list",
      "--head",
      args.head,
      "--state",
      args.state ?? "open",
      "--json",
      "number,headRefName,baseRefName,state,mergeable,mergeStateStatus,mergeCommit,url"
    ];
    if (args.base != null && args.base.length > 0) {
      argv.push("--base", args.base);
    }
    if (args.repo != null && args.repo.length > 0) {
      argv.push("--repo", args.repo);
    }
    const r = await runOrThrow("gh", this.runner, argv, this.execOpts(opts));
    return parseGhJson(r, external_exports.array(PullRequestSchema), "gh pr list");
  }
  async prCreate(args, opts) {
    const r = await runOrThrow(
      "gh",
      this.runner,
      ["pr", "create", "--base", args.base, "--head", args.head, "--title", args.title, "--body", args.body],
      this.execOpts(opts)
    );
    if (r.truncated) {
      throw new Error("gh pr create: output truncated \u2014 cannot trust the emitted PR URL");
    }
    const url = r.stdout.trim().split(/\s+/).pop() ?? "";
    const m = /\/pull\/(\d+)\s*$/.exec(url);
    if (!m) {
      throw new Error(`gh pr create: could not parse PR number from output: ${r.stdout.trim()}`);
    }
    return { number: Number(m[1]), url };
  }
  async prView(number, fields, opts) {
    const requested = Array.from(/* @__PURE__ */ new Set([...REQUIRED_VIEW_FIELDS, ...fields]));
    const r = await runOrThrow(
      "gh",
      this.runner,
      ["pr", "view", String(number), "--json", requested.join(",")],
      this.execOpts(opts)
    );
    return parseGhJson(r, PullRequestSchema, "gh pr view");
  }
  async prChecks(number, opts) {
    const r = await this.runner(["pr", "checks", String(number), "--json", "bucket"], this.execOpts(opts));
    if (r.truncated) {
      throw new Error("gh pr checks: output truncated \u2014 refusing to parse clipped checks JSON");
    }
    const stdout = r.stdout.trim();
    if (stdout === "" || stdout === "[]") {
      if (r.code !== 0 && !/no checks reported/i.test(r.stderr)) {
        throw new Error(`gh pr checks #${number} failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
      }
      return "none";
    }
    const rows = GhChecksSchema.parse(parseJson(stdout, "gh pr checks"));
    return aggregateChecks(rows);
  }
  async prMergeSquash(number, opts) {
    const argv = ["pr", "merge", String(number), "--squash"];
    if (opts?.auto === true) {
      argv.push("--auto");
    }
    if (opts?.deleteBranch === true) {
      argv.push("--delete-branch");
    }
    if (opts?.subject !== void 0) {
      argv.push("--subject", opts.subject);
    }
    if (opts?.body !== void 0) {
      argv.push("--body", opts.body);
    }
    await runOrThrow("gh", this.runner, argv, this.execOpts(opts));
  }
  async deleteRemoteBranch(owner, repo, branch, opts) {
    const path7 = `repos/${owner}/${repo}/git/refs/heads/${branch}`;
    const r = await this.runner(["api", "--method", "DELETE", path7], this.execOpts(opts));
    if (r.code !== 0 && !/Reference does not exist|Not Found|HTTP 404/i.test(r.stderr)) {
      throw new Error(`gh api DELETE ${path7} failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
    }
  }
  async branchExists(owner, repo, branch, opts) {
    return await this.branchTip(owner, repo, branch, opts) !== null;
  }
  async branchTip(owner, repo, branch, opts) {
    const path7 = `repos/${owner}/${repo}/branches/${branch}`;
    const r = await this.runner(["api", path7], this.execOpts(opts));
    if (r.code === 0) {
      if (r.truncated) {
        throw new Error(`gh api ${path7}: output truncated \u2014 refusing to parse clipped branch JSON`);
      }
      const parsed = external_exports.object({ commit: external_exports.object({ sha: external_exports.string() }) }).parse(parseJson(r.stdout, path7));
      return parsed.commit.sha;
    }
    if (/404|Not Found|Branch not found/i.test(r.stderr)) {
      return null;
    }
    throw ghApiFailure(path7, r);
  }
  async deleteProtection(owner, repo, branch, opts) {
    const argv = ["api", "-X", "DELETE", `/repos/${owner}/${repo}/branches/${branch}/protection`];
    const r = await this.runner(argv, this.execOpts(opts));
    if (r.code !== 0 && !/404|Not Found|Branch not protected/i.test(r.stderr)) {
      throw new Error(`gh api DELETE protection failed for ${owner}/${repo}@${branch}: ${r.stderr}`);
    }
  }
  async issueComment(args, opts) {
    const argv = ["issue", "comment", String(args.number), "--repo", args.repo, "--body", args.body];
    await runOrThrow("gh", this.runner, argv, this.execOpts(opts));
  }
  async listIssueComments(args, opts) {
    const r = await runOrThrow(
      "gh",
      this.runner,
      ["issue", "view", String(args.number), "--repo", args.repo, "--json", "comments"],
      this.execOpts(opts)
    );
    const parsed = parseGhJson(
      r,
      external_exports.object({ comments: external_exports.array(external_exports.object({ body: external_exports.string() })) }),
      "gh issue view comments"
    );
    return parsed.comments.map((c) => c.body);
  }
  async issueClose(args, opts) {
    const argv = ["issue", "close", String(args.number), "--repo", args.repo];
    if (args.comment !== void 0) {
      argv.push("--comment", args.comment);
    }
    await runOrThrow("gh", this.runner, argv, this.execOpts(opts));
  }
  async repoProtection(owner, repo, branch, opts) {
    const path7 = `repos/${owner}/${repo}/branches/${branch}/protection`;
    const r = await this.runner(["api", path7], this.execOpts(opts));
    if (r.code !== 0) {
      if (/404|Not Found|Branch not protected/i.test(r.stderr)) {
        return {
          enabled: false,
          requiredStatusChecks: [],
          strictUpToDate: false,
          hasMergeQueue: false
        };
      }
      throw ghApiFailure(path7, r);
    }
    if (r.truncated) {
      throw new Error(`gh api ${path7}: output truncated \u2014 refusing to parse clipped protection JSON`);
    }
    const raw = GhProtectionSchema.parse(parseJson(r.stdout, path7));
    const rsc = raw.required_status_checks ?? null;
    let mq = false;
    try {
      mq = await this.mergeQueueProbe(owner, repo, branch, opts);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log6.warn(`merge-queue probe failed during protection read (${detail}) \u2014 assuming no queue`);
    }
    return {
      enabled: true,
      requiredStatusChecks: rsc?.contexts ?? [],
      strictUpToDate: rsc?.strict === true,
      hasMergeQueue: mq
    };
  }
  async putProtection(owner, repo, branch, body, opts) {
    const path7 = `repos/${owner}/${repo}/branches/${branch}/protection`;
    const payload = JSON.stringify({
      required_status_checks: {
        strict: body.strict,
        contexts: body.requiredStatusChecks
      },
      enforce_admins: body.enforceAdmins ?? true,
      required_pull_request_reviews: null,
      restrictions: null,
      // D55: GitHub defaults allow_deletions to FALSE, which made every leftover
      // per-run staging branch undeletable by hand until its protection rule was
      // torn down via the API. The plugin never relies on deletion-blocking (its
      // own teardown always deletes protection first), so keep leftovers deletable.
      allow_deletions: true
    });
    log6.info(`provisioning branch protection for ${owner}/${repo}@${branch}`);
    await runOrThrow("gh", this.runner, ["api", "--method", "PUT", path7, "--input", "-"], {
      ...this.execOpts(opts),
      input: payload
    });
  }
  async mergeQueueProbe(owner, repo, branch, opts) {
    const path7 = `repos/${owner}/${repo}/rules/branches/${branch}`;
    const r = await this.runner(["api", path7], this.execOpts(opts));
    if (r.code !== 0) {
      if (/404|Not Found/i.test(r.stderr)) {
        return false;
      }
      throw ghApiFailure(path7, r);
    }
    if (r.truncated) {
      throw new Error(`gh api ${path7}: output truncated \u2014 refusing to parse clipped ruleset JSON`);
    }
    const rules = GhRulesSchema.safeParse(parseJson(r.stdout, path7));
    return rules.success && rules.data.some((rule) => rule.type === "merge_queue");
  }
};

// src/git/run-staging.ts
var RUN_STAGING_PREFIX = "staging";
var FALLBACK_STAGING_BRANCH = "staging";
function runStagingBranch(runId) {
  if (runId.length === 0) {
    throw new Error("runStagingBranch: empty run id (would yield a bare 'staging-' branch)");
  }
  return `${RUN_STAGING_PREFIX}-${runId}`;
}

// src/git/rollup.ts
var log7 = createLogger("git");
var GIT_DEFAULTS = GitSchema.parse({});
var DEFAULT_POLL_INTERVAL_MS = 15e3;
var DEFAULT_MAX_POLLS = 80;
var realSleep = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
function isBranchPolicyBlock(err) {
  return err instanceof Error && /base branch policy prohibits the merge/i.test(err.message);
}
async function waitForCi(gh, number, args) {
  const sleep = args.sleep ?? realSleep;
  const interval = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = args.maxPolls ?? DEFAULT_MAX_POLLS;
  let state = "pending";
  for (let i = 0; i < maxPolls; i++) {
    state = await gh.prChecks(number);
    if (state !== "pending") {
      return state;
    }
    if (i < maxPolls - 1) {
      await sleep(interval);
    }
  }
  return state;
}
async function rollup(args) {
  const staging = args.stagingBranch ?? FALLBACK_STAGING_BRANCH;
  const base = args.baseBranch ?? GIT_DEFAULTS.baseBranch;
  if (base === "main") {
    throw new Error("rollup: baseBranch must not be 'main' (Decision 16 \u2014 the factory never touches main)");
  }
  const subject = args.title;
  const existing = await args.ghClient.prList({ head: staging, base, state: "all" });
  const merged = existing.find((p) => p.state === "MERGED");
  if (merged) {
    log7.info(`rollup PR #${merged.number} already merged into ${base} \u2014 finalize resuming`);
    return { number: merged.number, url: merged.url ?? "", resumed: true, merged: true, subject };
  }
  const open2 = existing.find((p) => p.state === "OPEN");
  let number;
  let url;
  let resumed;
  if (open2) {
    log7.info(`resuming rollup PR #${open2.number} (${staging}\u2192${base})`);
    number = open2.number;
    url = open2.url ?? "";
    resumed = true;
  } else {
    const created = await args.ghClient.prCreate({
      base,
      head: staging,
      title: args.title,
      body: args.body
    });
    log7.info(`opened rollup PR #${created.number} (${staging}\u2192${base})`);
    number = created.number;
    url = created.url;
    resumed = false;
  }
  if (!args.merge) {
    log7.info(`rollup PR #${number}: no-merge mode \u2014 opened, not merged`);
    return { number, url, resumed, merged: false, reason: "no-merge" };
  }
  const ci = await waitForCi(args.ghClient, number, args);
  if (ci === "failing") {
    log7.warn(`rollup PR #${number}: CI failing \u2014 not merged`);
    return { number, url, resumed, merged: false, reason: "ci-failing", ci };
  }
  if (ci === "pending") {
    log7.warn(
      `rollup PR #${number}: CI still pending after ${args.maxPolls ?? DEFAULT_MAX_POLLS} polls \u2014 not merged`
    );
    return { number, url, resumed, merged: false, reason: "ci-timeout", ci };
  }
  const view = await args.ghClient.prView(number, ["number", "state", "mergeable", "mergeStateStatus"]);
  if (view.state === "MERGED") {
    return { number, url, resumed, merged: true, subject, ci };
  }
  if (view.mergeable === "CONFLICTING") {
    log7.warn(`rollup PR #${number} is CONFLICTING \u2014 not merged`);
    return { number, url, resumed, merged: false, reason: "not-mergeable", ci };
  }
  try {
    await args.ghClient.prMergeSquash(number, { subject, body: args.body });
    log7.info(`rollup PR #${number} squash-merged into ${base}`);
    return { number, url, resumed, merged: true, subject, ci };
  } catch (err) {
    if (!isBranchPolicyBlock(err)) {
      throw err;
    }
    log7.warn(`rollup PR #${number}: base branch policy prohibits an immediate merge \u2014 arming --auto`);
    await args.ghClient.prMergeSquash(number, { subject, body: args.body, auto: true });
    return { number, url, resumed, merged: false, reason: "auto-armed", ci };
  }
}

// src/git/branch.ts
var DEFAULT_PREFIX = GitSchema.parse({}).branchPrefix;
function runScopedBranch(runId, taskId, prefix = DEFAULT_PREFIX) {
  validateId(runId, "run-id");
  validateId(taskId, "task-id");
  if (prefix.length === 0 || prefix.includes("/")) {
    throw new Error(`branch: invalid prefix '${prefix}' (non-empty, no '/')`);
  }
  return `${prefix}/${runId}/${taskId}`;
}

// src/git/worktree.ts
import { existsSync as existsSync6 } from "node:fs";
var log8 = createLogger("git");
async function createTaskWorktree(args) {
  const remote = args.remote ?? "origin";
  const base = args.base ?? FALLBACK_STAGING_BRANCH;
  const branch = runScopedBranch(args.runId, args.taskId);
  const startPoint = `${remote}/${base}`;
  await args.gitClient.fetch(remote, base);
  if (await args.gitClient.worktreeExists(args.path)) {
    await ensureOnStaging({ gitClient: args.gitClient, path: args.path, branch, remote, base });
  } else {
    await args.gitClient.worktreeAdd(["-b", branch, args.path, startPoint]);
  }
  await assertBaseIsStagingTip({
    gitClient: args.gitClient,
    path: args.path,
    remote,
    base
  });
  return { path: args.path, branch, startPoint };
}
async function assertBaseIsStagingTip(args) {
  const remote = args.remote ?? "origin";
  const base = args.base ?? FALLBACK_STAGING_BRANCH;
  const opts = { cwd: args.path };
  const stagingTip = await args.gitClient.revParse(`${remote}/${base}`, opts);
  const mergeBase = await args.gitClient.mergeBase("HEAD", `${remote}/${base}`, opts);
  if (mergeBase !== stagingTip) {
    throw new Error(
      `worktree base drift: merge-base(HEAD, ${remote}/${base})=${mergeBase} != ${remote}/${base} tip=${stagingTip} \u2014 worktree did not birth on the staging tip (D12 invariant #4)`
    );
  }
}
async function ensureOnStaging(args) {
  const remote = args.remote ?? "origin";
  const base = args.base ?? FALLBACK_STAGING_BRANCH;
  const opts = { cwd: args.path };
  log8.debug(`ensureOnStaging: reset --hard + checkout -B ${args.branch} ${remote}/${base}`);
  await args.gitClient.resetHardClean(`${remote}/${base}`, opts);
  await args.gitClient.checkoutB(args.branch, `${remote}/${base}`, opts);
}
async function resyncTaskBranchOntoStaging(args) {
  const remote = args.remote ?? "origin";
  const opts = { cwd: args.cwd };
  await args.git.fetch(remote, args.stagingBranch, opts);
  const attempt = await args.git.tryMergeNoForce(args.branch, `${remote}/${args.stagingBranch}`, {
    ...opts,
    ...args.message !== void 0 ? { message: args.message } : {}
  });
  if (attempt.merged) {
    await args.git.push(remote, args.branch, opts);
  }
  return attempt;
}
async function removeWorktreeBestEffort(gitClient, path7) {
  const code = await gitClient.worktreeRemove(["--force", path7]);
  if (code !== 0 && existsSync6(path7)) {
    log8.warn(`worktree remove --force ${path7} exited ${code ?? "null"} \u2014 worktree may be leaked`);
  }
}

// src/git/provision.ts
import path from "node:path";
var log9 = createLogger("provision");
var LOCKFILE_INSTALL = [
  ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
  ["yarn.lock", "yarn install --frozen-lockfile"],
  ["package-lock.json", "npm ci"],
  ["npm-shrinkwrap.json", "npm ci"]
];
async function defaultRun(command, cwd) {
  const r = await exec(command, [], { cwd, shell: true });
  return { code: r.code, stderr: r.stderr };
}
async function resolveSetupCommand(worktreePath, setupCommand, fileExists) {
  if (setupCommand !== void 0 && setupCommand.trim().length > 0) {
    return setupCommand;
  }
  for (const [lockfile, command] of LOCKFILE_INSTALL) {
    if (await fileExists(path.join(worktreePath, lockfile))) {
      return command;
    }
  }
  return null;
}
async function provisionWorktree(args) {
  const fileExists = args.fileExists ?? pathExists;
  const run9 = args.run ?? defaultRun;
  const command = await resolveSetupCommand(args.path, args.setupCommand, fileExists);
  if (command === null) {
    log9.debug(`no setupCommand and no lockfile in ${args.path} \u2014 skipping worktree provisioning`);
    return;
  }
  log9.info(`provisioning worktree: ${command} (cwd=${args.path})`);
  const res = await run9(command, args.path);
  if (res.code !== 0) {
    const detail = res.stderr.trim();
    throw new Error(
      `worktree provisioning failed: \`${command}\` exited ${res.code ?? "null"} in ${args.path}` + (detail.length > 0 ? `
${detail}` : "")
    );
  }
}

// src/git/pr.ts
var log10 = createLogger("git");
async function createTaskPrIdempotent(args) {
  const base = args.base ?? FALLBACK_STAGING_BRANCH;
  const existing = await args.ghClient.prList({ head: args.branch, base, state: "all" });
  const mergedResume = args.knownPrNumber !== void 0 ? existing.find((p) => p.state === "MERGED" && p.number === args.knownPrNumber) : void 0;
  const pr = existing.find((p) => p.state === "OPEN") ?? mergedResume;
  if (pr !== void 0) {
    log10.info(`resuming existing PR #${pr.number} (${pr.state}) for head '${args.branch}' (no duplicate created)`);
    return { number: pr.number, url: pr.url ?? "", resumed: true };
  }
  const created = await args.ghClient.prCreate({
    base,
    head: args.branch,
    title: args.title,
    body: args.body
  });
  log10.info(`created PR #${created.number} for head '${args.branch}'`);
  return { number: created.number, url: created.url, resumed: false };
}

// src/git/serial-writer.ts
import { join as join5 } from "node:path";
var log11 = createLogger("git");
var realSleep2 = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
var DEFAULT_MERGEABILITY_POLL_MAX_TRIES = 5;
var DEFAULT_MERGEABILITY_POLL_INTERVAL_MS = 2e3;
var DEFAULT_MERGE_QUEUE_POLL_MAX_TRIES = 30;
var DEFAULT_MERGE_QUEUE_POLL_INTERVAL_MS = 1e4;
var MERGE_LOCK_DEFAULTS = {
  ...DEFAULT_FILE_LOCK_TUNING,
  stale: 3e4,
  retries: 100,
  retryMinTimeout: 25,
  retryMaxTimeout: 1e3
};
var MergeSerializer = class {
  ghClient;
  owner;
  repo;
  staging;
  dataDir;
  lockScope;
  tuning;
  mergeabilityPollMaxTries;
  mergeabilityPollIntervalMs;
  mergeabilityPollSleep;
  mergeQueuePollMaxTries;
  mergeQueuePollIntervalMs;
  mergeQueuePollSleep;
  constructor(opts) {
    this.ghClient = opts.ghClient;
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.staging = opts.stagingBranch ?? FALLBACK_STAGING_BRANCH;
    this.dataDir = resolveDataDir(opts);
    this.lockScope = opts.lockScope ?? `${opts.owner}__${opts.repo}__${this.staging}`.replace(/[^\w.-]/g, "-");
    this.tuning = { ...MERGE_LOCK_DEFAULTS, ...opts.lock ?? {} };
    this.mergeabilityPollMaxTries = opts.mergeabilityPoll?.maxTries ?? DEFAULT_MERGEABILITY_POLL_MAX_TRIES;
    this.mergeabilityPollIntervalMs = opts.mergeabilityPoll?.intervalMs ?? DEFAULT_MERGEABILITY_POLL_INTERVAL_MS;
    this.mergeabilityPollSleep = opts.mergeabilityPoll?.sleep ?? realSleep2;
    this.mergeQueuePollMaxTries = opts.mergeQueuePoll?.maxTries ?? DEFAULT_MERGE_QUEUE_POLL_MAX_TRIES;
    this.mergeQueuePollIntervalMs = opts.mergeQueuePoll?.intervalMs ?? DEFAULT_MERGE_QUEUE_POLL_INTERVAL_MS;
    this.mergeQueuePollSleep = opts.mergeQueuePoll?.sleep ?? realSleep2;
  }
  lockfilePath() {
    return join5(this.dataDir, "locks", `merge-${this.lockScope}.lock`);
  }
  /** Run `fn` while holding the app-level merge lock (the serial section). */
  async withMergeLock(fn) {
    return withFileLock(
      {
        dir: join5(this.dataDir, "locks"),
        lockfile: this.lockfilePath(),
        label: `merge '${this.lockScope}'`,
        dirPolicy: "create",
        tuning: this.tuning
      },
      fn
    );
  }
  /**
   * Serial-merge one task PR into staging. Acquires the app-level lock, RE-VERIFIES
   * mergeable + up-to-date against the CURRENT staging tip (so the 2nd of two
   * queued merges re-checks against the post-first-merge state), then either
   * enqueues via native merge-queue (probe upgrade) or squash-merges now. NEVER
   * arms N concurrent `--auto`.
   */
  async merge(prNumber) {
    return this.withMergeLock(async () => {
      const pr = await this.readSettledPr(prNumber);
      if (pr.state === "MERGED") {
        log11.info(`PR #${prNumber} already MERGED into ${this.staging} \u2014 ship resuming`);
        await this.deleteMergedHeadBestEffort(pr.headRefName);
        return { merged: true, via: "app-level", number: prNumber };
      }
      if (pr.mergeable === "CONFLICTING") {
        log11.warn(`PR #${prNumber} is CONFLICTING \u2014 not merged`);
        return { merged: false, reason: "not-mergeable", number: prNumber };
      }
      if (pr.mergeStateStatus === "BEHIND") {
        log11.warn(`PR #${prNumber} head is BEHIND ${this.staging} \u2014 refusing to merge (no force-push)`);
        return { merged: false, reason: "behind", number: prNumber };
      }
      let hasMergeQueue = false;
      try {
        hasMergeQueue = await this.ghClient.mergeQueueProbe(this.owner, this.repo, this.staging);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log11.warn(`merge-queue probe failed (${detail}) \u2014 falling back to app-level squash`);
      }
      if (hasMergeQueue) {
        await this.ghClient.prMergeSquash(prNumber, { auto: true, deleteBranch: true });
        log11.info(`PR #${prNumber} enqueued via native merge-queue \u2014 polling until the queue lands it`);
        return this.awaitQueueMerge(prNumber);
      }
      const mergeableNow = pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "HAS_HOOKS" || pr.mergeStateStatus === "UNSTABLE";
      if (!mergeableNow) {
        log11.warn(
          `PR #${prNumber} not mergeable now (mergeStateStatus=${pr.mergeStateStatus ?? "unset"}) \u2014 refusing app-level squash; ship will wait-retry`
        );
        return { merged: false, reason: "not-mergeable", number: prNumber };
      }
      await this.ghClient.prMergeSquash(prNumber, {});
      log11.info(`PR #${prNumber} squash-merged into ${this.staging} (app-level serial)`);
      await this.deleteMergedHeadBestEffort(pr.headRefName);
      return { merged: true, via: "app-level", number: prNumber };
    });
  }
  /**
   * Read the PR, polling while GitHub is still computing mergeability
   * (`mergeable === 'UNKNOWN'`) — Issue #1: a fresh push/update reports UNKNOWN
   * for a beat while GitHub's background mergeability job runs. Treating that as
   * a real refusal burns a full exec resync (MERGE_RESYNC_CAP) on a PR that was
   * actually fine. Stops as soon as `mergeable` settles to ANY terminal value
   * (MERGEABLE or CONFLICTING) or the budget is spent — still-UNKNOWN after the
   * budget falls through UNCHANGED to the existing refuse-and-resync path, so
   * this is never worse than today's behavior.
   *
   * NOTE: does NOT poll on `mergeStateStatus === 'UNKNOWN'` alone — that field
   * co-settles with `mergeable` in practice, and gating strictly on `mergeable`
   * keeps the poll narrow (see the serial-writer tests for the exact contract).
   */
  async readSettledPr(prNumber) {
    const fields = ["number", "headRefName", "baseRefName", "state", "mergeable", "mergeStateStatus"];
    let pr = await this.ghClient.prView(prNumber, fields);
    for (let tries = 1; pr.mergeable === "UNKNOWN" && tries < this.mergeabilityPollMaxTries; tries++) {
      await this.mergeabilityPollSleep(this.mergeabilityPollIntervalMs);
      pr = await this.ghClient.prView(prNumber, fields);
    }
    return pr;
  }
  /**
   * After a merge-queue `--auto` enqueue, poll until GitHub actually LANDS the
   * PR (`state === 'MERGED'`). An enqueue is a promise to merge, not a merge —
   * the queue can kick the PR out (CI failure) leaving it OPEN/CLOSED forever;
   * reporting `merged: true` at enqueue recorded a possibly-unmerged PR as done
   * (silent partial delivery). Exhaustion / a CLOSED PR → `not-mergeable`: ship
   * turns that into a bounded wait-retry, and a later drive re-enters merge()'s
   * idempotent MERGED-resume branch if the queue landed it in the meantime.
   */
  async awaitQueueMerge(prNumber) {
    for (let tries = 0; tries < this.mergeQueuePollMaxTries; tries++) {
      await this.mergeQueuePollSleep(this.mergeQueuePollIntervalMs);
      const pr = await this.ghClient.prView(prNumber, ["number", "state"]);
      if (pr.state === "MERGED") {
        log11.info(`PR #${prNumber} landed via native merge-queue`);
        return { merged: true, via: "merge-queue", number: prNumber };
      }
      if (pr.state === "CLOSED") {
        log11.warn(`PR #${prNumber} was CLOSED without merging \u2014 the queue kicked it out`);
        return { merged: false, reason: "not-mergeable", number: prNumber };
      }
    }
    log11.warn(
      `PR #${prNumber} still unmerged after the merge-queue poll budget (${this.mergeQueuePollMaxTries} \xD7 ${this.mergeQueuePollIntervalMs}ms) \u2014 refusing to report success`
    );
    return { merged: false, reason: "not-mergeable", number: prNumber };
  }
  /**
   * Delete the merged PR's remote head ref — BEST EFFORT. The squash-merge has
   * already landed, so a failed delete is cosmetic (a leaked remote branch): WARN
   * and continue, never throw. A throw here would turn the merge success into an
   * exception and, on the sanctioned `drive` retry, re-enter the MERGED branch and
   * fail on the SAME delete again — a wedge. (Contrast the cancel `--cleanup` path,
   * which surfaces this loudly: there the ref teardown IS the whole operation.)
   */
  async deleteMergedHeadBestEffort(headRefName) {
    try {
      await this.ghClient.deleteRemoteBranch(this.owner, this.repo, headRefName);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log11.warn(
        `post-merge cleanup: failed to delete remote head ref '${headRefName}' (merge already landed \u2014 leaked ref is cosmetic): ${detail}`
      );
    }
  }
};

// src/verifier/deterministic/gate-contract.ts
import { readFile as readFile4 } from "node:fs/promises";
import { join as join6 } from "node:path";

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
var log12 = createLogger("gate-contract");
var GATE_CONTRACT_REL = ".factory/gates.json";
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
var MUTATION_DEFAULT_ROOTS = ["src"];
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
async function loadGateContract(rootAbs) {
  let raw;
  try {
    raw = await readFile4(join6(rootAbs, GATE_CONTRACT_REL), "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      return { state: "absent" };
    }
    return { state: "invalid", error: `unreadable: ${err.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { state: "invalid", error: `not JSON: ${err.message}` };
  }
  const result = GateContractSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { state: "invalid", error: issues };
  }
  return { state: "ok", contract: result.data };
}
var DEFAULT_GATES = ["test", "tdd", "type"];
function defaultGatesForStack(stack) {
  return stack === "deno" ? DEFAULT_GATES : [...DEFAULT_GATES, "build"];
}
function enumerateGatesInForce(contract) {
  const contracted = [];
  const skipped = [];
  for (const id of GATE_IDS) {
    const entry = contract.gates[id];
    if (entry.contracted) {
      contracted.push(id);
    } else {
      skipped.push({ id, reason: entry.reason });
    }
  }
  const skippedById = new Map(skipped.map((s) => [s.id, s.reason]));
  const warnings = defaultGatesForStack(contract.stack).filter((id) => skippedById.has(id)).map(
    (id) => `default-set gate '${id}' is not contracted: ${skippedById.get(id) ?? ""} \u2014 the merge gate will not enforce it`
  );
  return { contracted, skipped, warnings };
}
var SCOPE_SKIP_REASONS = /* @__PURE__ */ new Set(["no-vitest-runnable-tests-in-scope", "no-mutable-changes"]);
function classifySkip(reason) {
  return SCOPE_SKIP_REASONS.has(reason) ? "scope" : "tooling";
}
function mutationRoots(contract) {
  const entry = contract?.gates.mutation;
  if (entry !== void 0 && entry.contracted && entry.roots !== void 0) {
    return entry.roots;
  }
  return MUTATION_DEFAULT_ROOTS;
}
function requiredCheckExtras(contract) {
  return {
    requiredChecks: contract?.requiredChecks ?? [],
    requireMutationAtRest: contract?.requireMutationAtRest ?? false
  };
}
async function loadRequiredCheckExtras(rootAbs) {
  const load = await loadGateContract(rootAbs);
  if (load.state === "invalid") {
    log12.warn(`${GATE_CONTRACT_REL} at ${rootAbs} is invalid \u2014 per-repo required checks ignored: ${load.error}`);
  }
  return requiredCheckExtras(load.state === "ok" ? load.contract : void 0);
}
function contractCommand(contract, id) {
  const entry = contract?.gates[id];
  if (entry === void 0 || !entry.contracted || entry.command === void 0) {
    return void 0;
  }
  const v = validateGateCommand(entry.command);
  if (!v.ok) {
    throw new Error(`gate contract: gate '${id}' command invalid (${v.reason}: ${v.detail})`);
  }
  return v.argv;
}

// src/git/protection.ts
var log13 = createLogger("git");
function effectiveProfiles(git, extras) {
  const union = (...lists) => [...new Set(lists.flat())];
  const run9 = union(git.developRequiredStatusChecks, extras.requiredChecks);
  const atRest = extras.requireMutationAtRest && run9.includes(MUTATION_CHECK_CONTEXT) ? [MUTATION_CHECK_CONTEXT] : [];
  return { run: run9, baseline: union(git.developBaselineStatusChecks, extras.requiredChecks, atRest) };
}
var ProtectionMissingError = class extends Error {
  branch;
  reasons;
  constructor(branch, reasons) {
    super(
      `branch protection on '${branch}' is insufficient \u2014 run refuses to start:
  - ${reasons.join(
        "\n  - "
      )}
Re-run with --provision to provision protection, or configure it manually.`
    );
    this.name = "ProtectionMissingError";
    this.branch = branch;
    this.reasons = reasons;
  }
};
async function probeProtection(args) {
  const branch = args.branch ?? FALLBACK_STAGING_BRANCH;
  const result = await args.ghClient.repoProtection(args.owner, args.repo, branch);
  return {
    enabled: result.enabled,
    requiredStatusChecks: result.requiredStatusChecks,
    strictUpToDate: result.strictUpToDate,
    hasMergeQueue: result.hasMergeQueue
  };
}
function requireProtectionOrRefuse(state, requiredChecks, branch = FALLBACK_STAGING_BRANCH, opts = {}) {
  const reasons = [];
  if (!state.enabled) {
    reasons.push("no branch protection is configured");
  }
  if (!state.strictUpToDate && (opts.requireStrict ?? true)) {
    reasons.push("required_status_checks.strict (branches up-to-date) is OFF");
  }
  for (const check of requiredChecks) {
    if (!state.requiredStatusChecks.includes(check)) {
      reasons.push(`required status check '${check}' is not enforced`);
    }
  }
  if (reasons.length > 0) {
    throw new ProtectionMissingError(branch, reasons);
  }
  return state;
}
async function provisionProtection(args) {
  const branch = args.branch ?? FALLBACK_STAGING_BRANCH;
  if (!args.provision) {
    throw new Error("provisionProtection called without --provision opt-in \u2014 refusing to mutate branch protection");
  }
  log13.info(`--provision: writing branch protection for ${args.owner}/${args.repo}@${branch}`);
  await args.ghClient.putProtection(args.owner, args.repo, branch, {
    requiredStatusChecks: [...args.requiredChecks],
    strict: true
  });
  return probeProtection({
    ghClient: args.ghClient,
    owner: args.owner,
    repo: args.repo,
    branch
  });
}
async function putBaselineProtection(args) {
  log13.info(`writing baseline branch protection for ${args.owner}/${args.repo}@${args.branch}`);
  await args.ghClient.putProtection(args.owner, args.repo, args.branch, {
    requiredStatusChecks: [...args.contexts],
    strict: false,
    enforceAdmins: false
  });
}

// src/git/staging.ts
var log14 = createLogger("git");
var GIT_DEFAULTS2 = GitSchema.parse({});
async function ensureStaging(args) {
  const remote = args.remote ?? "origin";
  const staging = args.stagingBranch ?? FALLBACK_STAGING_BRANCH;
  const base = args.baseBranch ?? GIT_DEFAULTS2.baseBranch;
  if (base === "main") {
    throw new Error("staging: baseBranch must not be 'main' (Decision 16 \u2014 the factory never touches main)");
  }
  await args.gitClient.fetch(remote, base);
  const stagingHead = await args.gitClient.lsRemoteHeads(remote, staging);
  if (stagingHead === null) {
    const baseHead = await args.gitClient.lsRemoteHeads(remote, base);
    if (baseHead === null) {
      throw new Error(`staging: base branch '${remote}/${base}' does not exist \u2014 cannot create staging`);
    }
    log14.info(`creating ${staging} from ${remote}/${base}`);
    await materializeStagingWorktree(args.gitClient, args.orchestratorWorktreePath, staging, remote, base);
    await args.gitClient.push(remote, staging, { setUpstream: true, cwd: args.orchestratorWorktreePath });
    return { created: true, stagingTip: baseHead };
  }
  await args.gitClient.fetch(remote, staging);
  const baseTip = await args.gitClient.revParse(`${remote}/${base}`, { cwd: args.cwd });
  const stagingTip = await args.gitClient.revParse(`${remote}/${staging}`, { cwd: args.cwd });
  if (baseTip === stagingTip) {
    return { created: false, stagingTip };
  }
  const mergeBase = await args.gitClient.mergeBase(`${remote}/${base}`, `${remote}/${staging}`, {
    cwd: args.cwd
  });
  if (mergeBase === stagingTip) {
    log14.info(`fast-forwarding ${staging} to ${remote}/${base}`);
    await materializeStagingWorktree(args.gitClient, args.orchestratorWorktreePath, staging, remote, base);
    await args.gitClient.push(remote, staging, { cwd: args.orchestratorWorktreePath });
    return { created: false, stagingTip: baseTip };
  }
  if (mergeBase === baseTip) {
    return { created: false, stagingTip };
  }
  throw new Error(
    `staging: ${remote}/${staging} and ${remote}/${base} have DIVERGED (merge-base=${mergeBase}, staging=${stagingTip}, base=${baseTip}) \u2014 refusing to reconcile (no silent main fallback)`
  );
}
async function materializeStagingWorktree(gitClient, path7, branch, remote, base) {
  if (await gitClient.worktreeExists(path7)) {
    await ensureOnStaging({ gitClient, path: path7, branch, remote, base });
  } else {
    await gitClient.worktreeAdd(["-b", branch, path7, `${remote}/${base}`]);
  }
}

// src/scoring/partial-report.ts
function buildPartialReport(run9, request, opts = {}) {
  const specById = new Map(request.tasks.map((t) => [t.task_id, t]));
  const orderOf = new Map(request.tasks.map((t, i) => [t.task_id, i]));
  const shipped = [];
  const failures = [];
  const incomplete = [];
  for (const task of Object.values(run9.tasks)) {
    const spec = specById.get(task.task_id);
    if (spec === void 0) {
      throw new Error(
        `buildPartialReport: run task '${task.task_id}' is absent from spec '${request.spec_id}' \u2014 run/spec mismatch (wrong spec paired with run ${run9.run_id})`
      );
    }
    if (task.status === "done") {
      shipped.push({
        task_id: task.task_id,
        title: spec.title,
        branch: task.branch,
        pr_number: task.pr_number
      });
    } else if (task.status === "failed") {
      failures.push({
        task_id: task.task_id,
        title: spec.title,
        failure_class: nonNull(task.failure_class),
        failure_reason: nonNull(task.failure_reason),
        unmet_criteria: [...spec.acceptance_criteria],
        branch: task.branch,
        pr_number: task.pr_number
      });
    } else {
      incomplete.push({ task_id: task.task_id, title: spec.title, status: task.status });
    }
  }
  const bySpecOrder = (a, b) => (orderOf.get(a.task_id) ?? 0) - (orderOf.get(b.task_id) ?? 0);
  shipped.sort(bySpecOrder);
  failures.sort(bySpecOrder);
  incomplete.sort(bySpecOrder);
  return {
    run_id: run9.run_id,
    run_status: run9.status,
    ...run9.terminal_reason !== void 0 ? { terminal_reason: run9.terminal_reason } : {},
    spec_id: run9.spec.spec_id,
    issue_number: run9.spec.issue_number,
    repo: run9.spec.repo,
    generated_at: opts.now ?? nowIso(),
    totals: {
      total: shipped.length + failures.length + incomplete.length,
      shipped: shipped.length,
      failed: failures.length,
      incomplete: incomplete.length
    },
    shipped,
    failures,
    incomplete,
    ...run9.e2e_phase?.status === "failed" ? { e2e_failure: run9.e2e_phase.reason } : {},
    ...run9.e2e_phase?.status === "done" && run9.e2e_phase.advisory !== void 0 ? { e2e_advisory: run9.e2e_phase.advisory } : {},
    ...buildE2eNarrative(run9),
    ...buildTraceability(run9),
    ...buildCrossVendorAbsences(run9, bySpecOrder),
    ...opts.warnings !== void 0 && opts.warnings.length > 0 ? { warnings: opts.warnings } : {},
    ...opts.gates !== void 0 ? { gates: opts.gates } : {},
    ...opts.gatesUnavailable !== void 0 ? { gates_unavailable: opts.gatesUnavailable } : {}
  };
}
function buildCrossVendorAbsences(run9, bySpecOrder) {
  const absences = Object.values(run9.tasks).filter((t) => t.cross_vendor_absent !== void 0).map((t) => ({ task_id: t.task_id, reason: nonNull(t.cross_vendor_absent).reason })).sort(bySpecOrder);
  return absences.length > 0 ? { cross_vendor_absences: absences } : {};
}
function buildTraceability(run9) {
  const gaps = (run9.traceability?.verdicts ?? []).filter((v) => v.verdict !== "met");
  return {
    ...run9.traceability?.status === "failed" ? { traceability_failure: run9.traceability.reason ?? "PRD traceability audit failed" } : {},
    ...gaps.length > 0 ? { traceability_gaps: gaps } : {}
  };
}
function buildE2eNarrative(run9) {
  const journeys = (run9.e2e_phase?.manifest ?? []).map((e) => e.title ?? e.spec_path);
  const reopened = Object.entries(run9.e2e_phase?.reopen_counts ?? {}).filter(([, n]) => n > 0).map(([id]) => id).sort();
  const warning = run9.e2e_assessment?.warning;
  return {
    ...journeys.length > 0 ? { e2e_journeys: journeys } : {},
    ...reopened.length > 0 ? { e2e_reopened: reopened } : {},
    ...warning !== void 0 ? { e2e_warnings: [warning] } : {},
    ...run9.e2e_assessment?.status === "failed" ? { e2e_assessment_failure: run9.e2e_assessment.reason ?? "e2e assessment failed" } : {}
  };
}
function splitReason(reason) {
  const i = reason.indexOf("\n");
  return i === -1 ? { plain: reason } : { plain: reason.slice(0, i), detail: reason.slice(i + 1) };
}
function reasonLines(header, reason) {
  const { plain, detail } = splitReason(reason);
  return detail === void 0 ? [header, plain] : [header, plain, "```", detail, "```"];
}
function gapRow(g) {
  return `- **${g.requirement}** (\`${g.verdict}\`): ${g.evidence}`;
}
function failureBlock(f, forPrd) {
  const lines = [
    "",
    `### \`${f.task_id}\` \u2014 ${f.title}`,
    `- **Class:** \`${f.failure_class}\``,
    `- **Reason:** ${f.failure_reason}`
  ];
  if (forPrd && f.branch !== void 0) {
    lines.push(`- **Branch:** \`${f.branch}\``);
  }
  if (forPrd && f.pr_number !== void 0) {
    lines.push(`- **PR:** #${f.pr_number}`);
  }
  lines.push("- **Unmet acceptance criteria:**");
  for (const c of f.unmet_criteria) {
    lines.push(forPrd ? `  - [ ] ${c}` : `  - ${c}`);
  }
  return lines;
}
function failureCommentMarker(runId) {
  return `<!-- factory:run-failed:${runId} -->`;
}
function selfHealCommentMarker(runId) {
  return `<!-- factory:self-heal:${runId} -->`;
}
function renderFailureComment(report, selfHealEligible = false) {
  const lines = [
    failureCommentMarker(report.run_id),
    `Factory run \`${report.run_id}\` failed \u2014 ${report.failures.length} task(s) failed. PRD left open for rescue/resume.`
  ];
  if (selfHealEligible) {
    lines.push(
      "",
      "_Self-heal: the runner retries the recoverable failure(s) via `factory rescue auto` (up to 3 cycles) before paging a human._"
    );
  }
  if (report.e2e_failure !== void 0) {
    lines.push("", ...reasonLines("### End-to-end verification failed", report.e2e_failure));
  }
  if (report.e2e_assessment_failure !== void 0) {
    lines.push("", ...reasonLines("### End-to-end setup failed before any task ran", report.e2e_assessment_failure));
  }
  if (report.traceability_failure !== void 0) {
    lines.push("", "### Unmet PRD requirements", report.traceability_failure);
    for (const g of report.traceability_gaps ?? []) {
      lines.push(gapRow(g));
    }
  }
  for (const failure of report.failures) {
    lines.push(...failureBlock(failure, true));
  }
  return lines.join("\n");
}
function statusLabel(status) {
  return status.toUpperCase();
}
function renderPartialReportMarkdown(report) {
  const out = [];
  out.push(`# Factory run report \u2014 \`${report.run_id}\``);
  out.push("");
  out.push(
    `**Status:** ${statusLabel(report.run_status)} \xB7 **Spec:** \`${report.spec_id}\` (PRD #${report.issue_number}) \xB7 **Repo:** ${report.repo}`
  );
  if (report.run_status === "failed" || report.run_status === "superseded") {
    out.push(`**Reason:** ${report.terminal_reason ?? "reason unavailable"}`);
  }
  out.push(`**Generated:** ${report.generated_at}`);
  out.push("");
  out.push(
    `**Tasks:** ${report.totals.total} total \xB7 ${report.totals.shipped} shipped \xB7 ${report.totals.failed} failed \xB7 ${report.totals.incomplete} incomplete`
  );
  out.push("");
  out.push(`## Shipped (${report.shipped.length})`);
  if (report.shipped.length === 0) {
    out.push("_none_");
  } else {
    for (const s of report.shipped) {
      const pr = s.pr_number !== void 0 ? ` \u2014 PR #${s.pr_number}` : "";
      const br = s.branch !== void 0 ? ` (\`${s.branch}\`)` : "";
      out.push(`- \`${s.task_id}\` \u2014 ${s.title}${pr}${br}`);
    }
  }
  out.push("");
  if (report.gates !== void 0) {
    out.push("## Gates in force");
    out.push(`Enforced: ${report.gates.contracted.map((id) => `\`${id}\``).join(", ") || "_none_"}`);
    if (report.gates.skipped.length > 0) {
      out.push("");
      out.push("Not contracted:");
      for (const s of report.gates.skipped) {
        out.push(`- \`${s.id}\` \u2014 ${s.reason}`);
      }
    }
    for (const w of report.gates.warnings) {
      out.push("");
      out.push(`\u26A0\uFE0F ${w}`);
    }
    out.push("");
  } else if (report.gates_unavailable !== void 0) {
    out.push("## Gates in force");
    out.push(`\u26A0\uFE0F gate contract unavailable at finalize: ${report.gates_unavailable}`);
    out.push("");
  }
  if (report.e2e_journeys !== void 0) {
    out.push(`## End-to-end journeys verified (${report.e2e_journeys.length})`);
    for (const j of report.e2e_journeys) {
      out.push(`- ${j}`);
    }
    out.push("");
  }
  if (report.e2e_reopened !== void 0) {
    out.push("## Found by end-to-end testing");
    out.push(
      `The e2e suite caught failing journeys and sent ${report.e2e_reopened.length} task(s) back for fixes: ${report.e2e_reopened.map((id) => `\`${id}\``).join(", ")}`
    );
    out.push("");
  }
  if (report.e2e_warnings !== void 0) {
    out.push("## End-to-end warnings");
    for (const w of report.e2e_warnings) {
      out.push(`- ${w}`);
    }
    out.push("");
  }
  if (report.warnings !== void 0) {
    out.push("## Warnings");
    for (const w of report.warnings) {
      out.push(`- ${w}`);
    }
    out.push("");
  }
  if (report.cross_vendor_absences !== void 0) {
    out.push("## Review independence");
    out.push(
      `${report.cross_vendor_absences.length} task(s) were reviewed WITHOUT an independent second-vendor reviewer:`
    );
    for (const a of report.cross_vendor_absences) {
      out.push(`- \`${a.task_id}\` \u2014 ${a.reason}`);
    }
    out.push("");
  }
  if (report.e2e_assessment_failure !== void 0) {
    out.push(...reasonLines("## End-to-end setup failed before any task ran", report.e2e_assessment_failure));
    out.push("");
  }
  if (report.e2e_failure !== void 0) {
    out.push(...reasonLines("## End-to-end verification failed", report.e2e_failure));
    out.push("");
  }
  if (report.e2e_advisory !== void 0) {
    out.push("## End-to-end verification \u2014 advisory");
    out.push(report.e2e_advisory);
    out.push("");
  }
  if (report.traceability_failure !== void 0) {
    out.push("## PRD traceability failed");
    out.push(report.traceability_failure);
    out.push("");
  }
  if (report.traceability_gaps !== void 0) {
    out.push("## PRD requirement gaps");
    for (const g of report.traceability_gaps) {
      out.push(gapRow(g));
    }
    out.push("");
  }
  if (report.failures.length > 0) {
    out.push(`## Failed (${report.failures.length})`);
    for (const f of report.failures) {
      out.push(...failureBlock(f, false));
    }
    out.push("");
  }
  if (report.incomplete.length > 0) {
    out.push(`## Incomplete (${report.incomplete.length})`);
    for (const i of report.incomplete) {
      out.push(`- \`${i.task_id}\` \u2014 ${i.title} (\`${i.status}\`)`);
    }
    out.push("");
  }
  return out.join("\n");
}

// src/scoring/summary.ts
function durationSeconds(startedAt, endedAt) {
  if (endedAt === null) {
    return null;
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const delta = Math.floor((end - start) / 1e3);
  return delta >= 0 ? delta : null;
}
function touchMetricOf(run9) {
  const touches = run9.human_touches.length;
  if (touches === 0) {
    return null;
  }
  return (run9.status === "completed" ? 1 : 0) / touches;
}
function missesByLensOf(run9) {
  const byLens = {};
  for (const e of run9.misses) {
    const key = e.lens ?? "none";
    byLens[key] = (byLens[key] ?? 0) + 1;
  }
  return byLens;
}
function buildRunSummary(run9, report, opts = {}) {
  const failuresByClass = Object.fromEntries(FailureClassEnum.options.map((c) => [c, 0]));
  for (const f of report.failures) {
    failuresByClass[f.failure_class] += 1;
  }
  const tasks = Object.values(run9.tasks);
  const effort = {
    reviewer_results: tasks.reduce((n, t) => n + t.reviewers.length, 0),
    max_escalation_rung: tasks.reduce((m, t) => Math.max(m, t.escalation_rung), 0)
  };
  const shipped_prs = report.shipped.map((s) => ({
    task_id: s.task_id,
    ...s.pr_number !== void 0 ? { pr_number: s.pr_number } : {},
    ...s.branch !== void 0 ? { branch: s.branch } : {}
  }));
  const touches = run9.human_touches.length;
  const touchMetric = touchMetricOf(run9);
  return {
    run_id: run9.run_id,
    run_status: run9.status,
    ...run9.terminal_reason !== void 0 ? { terminal_reason: run9.terminal_reason } : {},
    execution_mode: run9.execution_mode,
    spec_id: run9.spec.spec_id,
    issue_number: run9.spec.issue_number,
    repo: run9.spec.repo,
    generated_at: opts.now ?? nowIso(),
    timing: {
      started_at: run9.started_at,
      ended_at: run9.ended_at,
      duration_seconds: durationSeconds(run9.started_at, run9.ended_at)
    },
    totals: report.totals,
    failures_by_class: failuresByClass,
    effort,
    shipped_prs,
    tasks_without_cross_vendor: report.cross_vendor_absences?.length ?? 0,
    touches,
    touch_metric: touchMetric,
    misses: run9.misses.length,
    misses_by_lens: missesByLensOf(run9)
  };
}

// src/scoring/telemetry.ts
var log15 = createLogger("telemetry");
async function writeMetric(dataDir, runId, event, data, opts) {
  const record = {
    ts: opts.now ?? nowIso(),
    run_id: runId,
    event,
    ...data !== void 0 ? { data } : {}
  };
  try {
    await appendJsonl(runMetricsPath(dataDir, runId), record);
    return { record, written: true };
  } catch (err) {
    log15.warn(`failed to write metric '${event}' for ${runId}: ${err.message}`);
    return { record, written: false };
  }
}
async function emitMetric(dataDir, runId, event, data, opts = {}) {
  return (await writeMetric(dataDir, runId, event, data, opts)).record;
}
async function readMetrics(dataDir, runId) {
  return readJsonl(runMetricsPath(dataDir, runId));
}
async function recordRunFinalized(dataDir, report, opts = {}) {
  const now = opts.now ?? nowIso();
  let dropped = 0;
  const finalized = await writeMetric(
    dataDir,
    report.run_id,
    "run.finalized",
    {
      status: report.run_status,
      spec_id: report.spec_id,
      issue_number: report.issue_number,
      totals: report.totals
    },
    { now }
  );
  if (!finalized.written) {
    dropped++;
  }
  for (const f of report.failures) {
    const r = await writeMetric(
      dataDir,
      report.run_id,
      "task.dropped",
      { task_id: f.task_id, failure_class: f.failure_class },
      { now }
    );
    if (!r.written) {
      dropped++;
    }
  }
  if (dropped > 0) {
    log15.warn(
      `telemetry: ${dropped} metric write(s) dropped this run (${report.run_id}); the metrics stream is incomplete`
    );
    await writeMetric(dataDir, report.run_id, "telemetry.writes_dropped", { dropped }, { now });
  }
}

// src/scoring/reviewer-value.ts
var ReviewRoundDataSchema = external_exports.object({
  outcome: external_exports.enum(["advance", "send-back", "environmental"]),
  reviewers: external_exports.array(
    external_exports.object({
      reviewer: external_exports.string().min(1),
      confirmed_blockers: external_exports.number().int().min(0).default(0),
      /**
       * The two funnel denominators (7b/2). `.optional()`, NEVER `.default(0)`:
       * a pre-7b/2 round genuinely has no denominator, and a fabricated `0`
       * would read as "raised nothing" — indistinguishable from a lens that
       * raised findings and had them all dropped. Absent ⇒ excluded from the
       * rates and counted in `rounds_without_funnel` (D49 backfill honesty).
       */
      raised_blockers: external_exports.number().int().min(0).optional(),
      cited_blockers: external_exports.number().int().min(0).optional()
    })
  ).default([]),
  cross_vendor_absent: external_exports.boolean().optional()
});
function parseReviewRounds(metrics) {
  const out = [];
  for (const m of metrics) {
    if (m.event !== "review.round") {
      continue;
    }
    const parsed = ReviewRoundDataSchema.safeParse(m.data);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }
  return out;
}
function aggregateReviewerValue(runs) {
  const byLens = /* @__PURE__ */ new Map();
  const acc = (lens) => {
    let a = byLens.get(lens);
    if (a === void 0) {
      a = {
        rounds: 0,
        confirmed_blockers: 0,
        send_back_blocker_rounds: 0,
        misses: 0,
        raised: 0,
        cited: 0,
        cited_resolved: 0,
        confirmed_resolved: 0
      };
      byLens.set(lens, a);
    }
    return a;
  };
  let runsCovered = 0;
  let runsWithoutEvents = 0;
  let crossVendorAbsentRounds = 0;
  let unattributedMisses = 0;
  let roundsWithoutFunnel = 0;
  for (const run9 of runs) {
    if (run9.rounds.length > 0) {
      runsCovered += 1;
    } else {
      runsWithoutEvents += 1;
    }
    for (const round of run9.rounds) {
      if (round.cross_vendor_absent === true) {
        crossVendorAbsentRounds += 1;
      }
      if (round.reviewers.length > 0 && round.reviewers.every((r) => r.raised_blockers === void 0)) {
        roundsWithoutFunnel += 1;
      }
      for (const r of round.reviewers) {
        const a = acc(r.reviewer);
        a.rounds += 1;
        a.confirmed_blockers += r.confirmed_blockers;
        if (r.confirmed_blockers > 0 && round.outcome === "send-back") {
          a.send_back_blocker_rounds += 1;
        }
        if (r.raised_blockers !== void 0 && r.cited_blockers !== void 0) {
          a.raised += r.raised_blockers;
          a.cited += r.cited_blockers;
          if (round.outcome !== "environmental") {
            a.cited_resolved += r.cited_blockers;
            a.confirmed_resolved += r.confirmed_blockers;
          }
        }
      }
    }
    for (const e of run9.misses) {
      if (e.lens !== void 0 && e.lens !== "none") {
        acc(e.lens).misses += 1;
      } else {
        unattributedMisses += 1;
      }
    }
  }
  const lenses = [...byLens.entries()].map(([lens, a]) => ({
    lens,
    rounds: a.rounds,
    confirmed_blockers: a.confirmed_blockers,
    yield: a.rounds > 0 ? a.confirmed_blockers / a.rounds : null,
    send_back_rate: a.rounds > 0 ? a.send_back_blocker_rounds / a.rounds : null,
    citation_rate: a.raised > 0 ? a.cited / a.raised : null,
    confirm_rate: a.cited_resolved > 0 ? a.confirmed_resolved / a.cited_resolved : null,
    misses: a.misses
  })).sort((x, y) => (y.yield ?? -1) - (x.yield ?? -1) || x.lens.localeCompare(y.lens));
  return {
    lenses,
    runs_covered: runsCovered,
    runs_without_events: runsWithoutEvents,
    cross_vendor_absent_rounds: crossVendorAbsentRounds,
    unattributed_misses: unattributedMisses,
    rounds_without_funnel: roundsWithoutFunnel
  };
}

// src/quota/usage-source.ts
import { existsSync as existsSync7, readFileSync as readFileSync3 } from "node:fs";
import { join as join7 } from "node:path";
var log16 = createLogger("quota:usage");
var STALE_CEILING_SECONDS = 3600;
var STALE_WARN_SECONDS = 120;
var RawWindowSchema = external_exports.object({
  used_percentage: external_exports.unknown().optional(),
  resets_at: external_exports.unknown().optional()
}).passthrough();
var RawCacheSchema = external_exports.object({
  five_hour: RawWindowSchema.optional(),
  seven_day: RawWindowSchema.optional(),
  captured_at: external_exports.unknown().optional()
}).passthrough();
function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}
function unavailable(reason) {
  return { kind: "unavailable", reason };
}
function readingFromCache(raw, nowEpoch2) {
  const parsed = RawCacheSchema.safeParse(raw);
  if (!parsed.success) {
    return unavailable("usage-cache-malformed");
  }
  const cache = parsed.data;
  const capturedAt = asFiniteNumber(cache.captured_at) ?? 0;
  const age = nowEpoch2 - capturedAt;
  if (age > STALE_CEILING_SECONDS) {
    return unavailable("usage-cache-too-stale");
  }
  if (age > STALE_WARN_SECONDS) {
    log16.warn(`usage-cache.json is ${age}s old (>${STALE_WARN_SECONDS}s) \u2014 data may be stale`);
  }
  const fivePct = asFiniteNumber(cache.five_hour?.used_percentage);
  const sevenPct = asFiniteNumber(cache.seven_day?.used_percentage);
  if (fivePct === null || sevenPct === null) {
    return unavailable("usage-cache-fields-missing");
  }
  const fiveResets = asFiniteNumber(cache.five_hour?.resets_at);
  const sevenResets = asFiniteNumber(cache.seven_day?.resets_at);
  if (fiveResets === null || sevenResets === null) {
    return unavailable("resets-at-missing");
  }
  if (fiveResets <= nowEpoch2) {
    return unavailable("five-hour-window-reset");
  }
  if (sevenResets <= nowEpoch2) {
    return unavailable("seven-day-window-reset");
  }
  return {
    kind: "available",
    fiveHour: { utilizationPct: fivePct, resetsAtEpoch: fiveResets },
    sevenDay: { utilizationPct: sevenPct, resetsAtEpoch: sevenResets },
    capturedAt
  };
}
function usageCachePath(dataDir) {
  return join7(dataDir, "usage-cache.json");
}
var StatuslineUsageSignal = class {
  opts;
  constructor(opts = {}) {
    this.opts = opts;
  }
  read() {
    return Promise.resolve(this.readSync());
  }
  readSync() {
    const now = (this.opts.now ?? nowEpoch)();
    let dataDir;
    try {
      dataDir = resolveDataDir(this.opts);
    } catch {
      return unavailable("usage-cache-missing");
    }
    const file = usageCachePath(dataDir);
    if (!existsSync7(file)) {
      log16.warn(`usage-cache.json not found at ${file}; emitting unavailable sentinel`);
      return unavailable("usage-cache-missing");
    }
    let raw;
    try {
      raw = parseJson(readFileSync3(file, "utf8"), file);
    } catch (err) {
      log16.warn(
        `usage-cache.json is malformed at ${file}: ${err.message}; emitting unavailable sentinel`
      );
      return unavailable("usage-cache-malformed");
    }
    return readingFromCache(raw, now);
  }
};

// src/quota/window.ts
var FIVE_HOUR_WINDOW_SECONDS = 18e3;
var SEVEN_DAY_WINDOW_SECONDS = 604800;
var SECONDS_PER_HOUR = 3600;
var SECONDS_PER_DAY = 86400;
var MIN_HOUR = 1;
var MAX_HOUR = 5;
var MIN_DAY = 1;
var MAX_DAY = 7;
function clamp(value, lo, hi) {
  if (value < lo) {
    return lo;
  }
  if (value > hi) {
    return hi;
  }
  return value;
}
function computeWindowHour(resetsAtEpoch, nowEpoch2) {
  const windowStart = resetsAtEpoch - FIVE_HOUR_WINDOW_SECONDS;
  const elapsed = nowEpoch2 - windowStart;
  const hour = Math.floor(elapsed / SECONDS_PER_HOUR) + 1;
  return clamp(hour, MIN_HOUR, MAX_HOUR);
}
function computeWindowDay(resetsAtEpoch, nowEpoch2) {
  const windowStart = resetsAtEpoch - SEVEN_DAY_WINDOW_SECONDS;
  const elapsed = nowEpoch2 - windowStart;
  const day = Math.floor(elapsed / SECONDS_PER_DAY) + 1;
  return clamp(day, MIN_DAY, MAX_DAY);
}
function hourlyThresholdFor(hour, hourlyThresholds) {
  return curveValue(hour, hourlyThresholds);
}
function dailyThresholdFor(day, dailyThresholds) {
  return curveValue(day, dailyThresholds);
}
function curveValue(position, curve) {
  if (curve.length === 0) {
    throw new RangeError("quota curve is empty \u2014 cannot resolve a threshold (config defect)");
  }
  const idx = clamp(position - 1, 0, curve.length - 1);
  return at(curve, idx);
}

// src/quota/pacer.ts
function evaluate(reading, config, nowEpoch2) {
  if (reading.kind === "unavailable") {
    return { kind: "unavailable-halt", reason: `usage unavailable: ${reading.reason}` };
  }
  const { hourlyThresholds, dailyThresholds } = config.quota;
  const windowHour = computeWindowHour(reading.fiveHour.resetsAtEpoch, nowEpoch2);
  const hourlyCap = hourlyThresholdFor(windowHour, hourlyThresholds);
  const fiveOver = reading.fiveHour.utilizationPct > hourlyCap;
  const windowDay = computeWindowDay(reading.sevenDay.resetsAtEpoch, nowEpoch2);
  const dailyCap = dailyThresholdFor(windowDay, dailyThresholds);
  const sevenOver = reading.sevenDay.utilizationPct > dailyCap;
  if (sevenOver) {
    return {
      kind: "suspend-7d",
      resetsAtEpoch: reading.sevenDay.resetsAtEpoch,
      reason: `7d quota over curve: ${reading.sevenDay.utilizationPct}% used > ${dailyCap}% cap at window-day ${windowDay}`
    };
  }
  if (fiveOver) {
    return {
      kind: "pause-5h",
      resetsAtEpoch: reading.fiveHour.resetsAtEpoch,
      reason: `5h quota over curve: ${reading.fiveHour.utilizationPct}% used > ${hourlyCap}% cap at window-hour ${windowHour}`
    };
  }
  return { kind: "proceed" };
}

// src/quota/checkpoint.ts
function buildCheckpoint(decision) {
  switch (decision.kind) {
    case "pause-5h":
      return {
        status: "paused",
        quota: QuotaCheckpointSchema.parse({
          binding_window: "5h",
          resets_at_epoch: decision.resetsAtEpoch
        })
      };
    case "suspend-7d":
      return {
        status: "suspended",
        quota: QuotaCheckpointSchema.parse({
          binding_window: "7d",
          resets_at_epoch: decision.resetsAtEpoch
        })
      };
  }
}
function buildUnavailableCheckpoint() {
  return {
    status: "suspended",
    quota: QuotaCheckpointSchema.parse({ binding_window: "unavailable" })
  };
}
function clearCheckpoint() {
  return { status: "running", quota: void 0 };
}

// src/quota/router.ts
function selectProducerModel(riskTier, config) {
  const models = config.quota.producerModels;
  switch (riskTier) {
    case "low":
      return models.low;
    case "medium":
      return models.medium;
    case "high":
      return models.high;
    default:
      return assertNever(riskTier);
  }
}

// src/quota/resume.ts
function planResume(run9, reading, config, nowEpoch2) {
  if (run9.status !== "paused" && run9.status !== "suspended") {
    return { kind: "not-resumable", status: run9.status };
  }
  if (run9.ignore_quota) {
    return { kind: "resume", clear: clearCheckpoint() };
  }
  if (run9.quota === void 0) {
    return { kind: "resume", clear: clearCheckpoint() };
  }
  const decision = evaluate(reading, config, nowEpoch2);
  if (decision.kind === "proceed") {
    return { kind: "resume", clear: clearCheckpoint() };
  }
  return { kind: "pause", decision };
}

// src/spec/schema.ts
var SpecTaskSchema = external_exports.object({
  /** Stable task id within the spec (charset enforced by the consumer). */
  task_id: external_exports.string().min(1),
  /** Short human title. */
  title: external_exports.string().min(1),
  /** What the task delivers. */
  description: external_exports.string().min(1),
  /**
   * The files this task touches — 1..3 (the ≤3-files granularity invariant the
   * spec reviewer also enforces). Empty or >3 is a loud parse error.
   */
  files: external_exports.array(external_exports.string().min(1)).min(1).max(3),
  /** ≥1 acceptance criterion; each must be testable (gate enforces non-vagueness). */
  acceptance_criteria: external_exports.array(external_exports.string().min(1)).min(1),
  /** Concrete test descriptions to write first (TDD). ≥1. */
  tests_to_write: external_exports.array(external_exports.string().min(1)).min(1),
  /** Task ids this task depends on (may be empty for a root task). */
  depends_on: external_exports.array(external_exports.string().min(1)).default([]),
  /**
   * The SINGLE producer dial (Decision 25) — the generator's whole-PRD
   * difficulty×stakes judgment. Imported from the frozen seam; the legacy
   * routine/feature/security values parse-fail here.
   */
  risk_tier: RiskTierEnum,
  /** Why this tier — required so the dial is a judgment, not a coin flip. */
  risk_rationale: external_exports.string().min(1),
  /** Per-task TDD opt-out (read from the spec, never from runtime state). */
  tdd_exempt: external_exports.boolean().optional()
}).strict();
var SpecTasksSchema = external_exports.array(SpecTaskSchema).min(1);
var SpecManifestSchema = external_exports.object({
  spec_id: external_exports.string().min(1),
  issue_number: external_exports.number().int().positive(),
  slug: external_exports.string().min(1),
  /** Repo identity, e.g. "owner/name" (sanitized to a path segment by the store). */
  repo: external_exports.string().min(1),
  /** ISO-8601 creation timestamp. */
  generated_at: external_exports.string().min(1),
  tasks: SpecTasksSchema
}).strict();
function parseSpecTasks(raw) {
  return SpecTasksSchema.parse(raw);
}
function parseSpecManifest(raw) {
  return SpecManifestSchema.parse(raw);
}
var PrdSchema = external_exports.object({
  issue_number: external_exports.number(),
  title: external_exports.string(),
  body: external_exports.string(),
  labels: external_exports.array(external_exports.string()),
  body_truncated: external_exports.boolean()
}).strict();
function parsePrd(raw, source) {
  const result = PrdSchema.safeParse(raw);
  if (!result.success) {
    const where = source != null && source.length > 0 ? ` (${source})` : "";
    throw new Error(`invalid PRD snapshot${where}: ${result.error.message}`);
  }
  return result.data;
}

// src/spec/gh.ts
var log17 = createLogger("spec:gh");
var GhAuthError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "GhAuthError";
  }
};
var IssueNotFoundError = class extends Error {
  issueNumber;
  constructor(issueNumber, message) {
    super(message);
    this.name = "IssueNotFoundError";
    this.issueNumber = issueNumber;
  }
};
var AUTH_HINT = /not logged|gh auth login|authentication|HTTP 401|requires authentication/i;
var NOT_FOUND_HINT = /could not resolve to|not found|HTTP 404|no issue|GraphQL: Could not/i;
var RealGhClient = class {
  exec;
  bodyMaxBytes;
  constructor(opts = {}) {
    this.exec = opts.exec ?? exec;
    this.bodyMaxBytes = opts.bodyMaxBytes ?? SPEC_DEFAULTS.prdBodyMaxBytes;
  }
  async fetchPrd(issueNumber, opts = {}) {
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new Error(`fetchPrd: issue number must be a positive integer, got ${issueNumber}`);
    }
    const args = ["issue", "view", String(issueNumber), "--json", "number,title,body,labels"];
    if (opts.repo != null && opts.repo.length > 0) {
      args.push("--repo", opts.repo);
    }
    const result = await this.exec("gh", args, { timeoutMs: 3e4 });
    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      if (AUTH_HINT.test(stderr)) {
        throw new GhAuthError(`gh is not authenticated (run \`gh auth login\`): ${stderr}`);
      }
      if (NOT_FOUND_HINT.test(stderr)) {
        throw new IssueNotFoundError(
          issueNumber,
          `issue #${issueNumber} not found${opts.repo != null && opts.repo.length > 0 ? ` in ${opts.repo}` : ""}: ${stderr}`
        );
      }
      throw new Error(`gh issue view #${issueNumber} failed (code=${result.code ?? "null"}): ${stderr}`);
    }
    if (result.truncated) {
      throw new Error(`gh issue view #${issueNumber} output was truncated; cannot parse a clipped payload`);
    }
    const raw = parseJson(result.stdout, `gh issue #${issueNumber}`);
    const parsed = raw !== null && typeof raw === "object" ? raw : {};
    const title = typeof parsed.title === "string" ? parsed.title : "";
    if (title.length === 0) {
      throw new Error(`gh issue view #${issueNumber}: missing or empty title in response`);
    }
    const rawBody = typeof parsed.body === "string" ? parsed.body : "";
    const { body, body_truncated } = this.capBody(rawBody);
    if (body_truncated) {
      log17.warn(`PRD body for issue #${issueNumber} exceeded ${this.bodyMaxBytes} bytes; truncated`);
    }
    const labels = Array.isArray(parsed.labels) ? parsed.labels.map(
      (l) => l != null && typeof l === "object" && "name" in l && typeof l.name === "string" ? l.name : typeof l === "string" ? l : null
    ).filter((l) => l !== null) : [];
    return {
      issue_number: issueNumber,
      title,
      body,
      labels,
      body_truncated
    };
  }
  /** Cap the body to `bodyMaxBytes` on a UTF-8 byte boundary. */
  capBody(body) {
    const buf = Buffer.from(body, "utf8");
    if (buf.length <= this.bodyMaxBytes) {
      return { body, body_truncated: false };
    }
    const clipped = buf.subarray(0, this.bodyMaxBytes).toString("utf8");
    return { body: clipped, body_truncated: true };
  }
};

// src/spec/store.ts
import { access as access2, readFile as readFile6, readdir as readdir2, rm as rm2 } from "node:fs/promises";
import { join as join9 } from "node:path";

// src/spec/ledger.ts
import { readFile as readFile5, mkdir as mkdir6 } from "node:fs/promises";
import { join as join8, dirname as dirname6 } from "node:path";
var LEDGER_FILE = "ledger.json";
var LedgerEntrySchema = external_exports.object({
  task_id: external_exports.string().min(1),
  run_id: external_exports.string().min(1),
  /** GitHub PR number, when the entry came from a shipped PR. */
  pr_number: external_exports.number().int().positive().optional(),
  /** The commit SHAs that carry this task's work (min 1 — an unevidenced entry is useless). */
  shas: external_exports.array(external_exports.string().min(7)).min(1),
  verified_at: external_exports.string().min(1),
  source: external_exports.enum(["shipped", "already-satisfied"])
}).strict();
var LedgerSchema = external_exports.object({ entries: external_exports.array(LedgerEntrySchema) }).strict();
function ledgerPath(dataDir, repo, specId) {
  return join8(specDir(dataDir, repo, specId), LEDGER_FILE);
}
async function readLedger(dataDir, repo, specId) {
  const path7 = ledgerPath(dataDir, repo, specId);
  let raw;
  try {
    raw = await readFile5(path7, "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      return { entries: [] };
    }
    throw err;
  }
  return LedgerSchema.parse(parseJson(raw, path7));
}
async function appendLedgerEntries(dataDir, repo, specId, entries) {
  const path7 = ledgerPath(dataDir, repo, specId);
  const current = await readLedger(dataDir, repo, specId);
  const next = LedgerSchema.parse({ entries: [...current.entries, ...entries] });
  await mkdir6(dirname6(path7), { recursive: true });
  await atomicWriteFile(path7, stringifyJson(next));
}
function latestByTask(ledger) {
  const map = /* @__PURE__ */ new Map();
  for (const e of ledger.entries) {
    map.set(e.task_id, e);
  }
  return map;
}

// src/spec/store.ts
var log18 = createLogger("spec:store");
var SPEC_MD_FILE = "spec.md";
var TASKS_FILE = "tasks.json";
var PRD_FILE = "prd.json";
function makeSpecId(issueNumber, slug) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`makeSpecId: issue number must be a positive integer, got ${issueNumber}`);
  }
  const safeSlug = slugify(slug);
  if (safeSlug.length === 0) {
    throw new Error(`makeSpecId: slug '${slug}' has no usable characters`);
  }
  const specId = `${issueNumber}-${safeSlug}`;
  validateId(specId, "spec-id");
  return specId;
}
function issueOf(specId) {
  const m = /^(\d+)-/.exec(specId);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
var SpecStore = class {
  dataDir;
  docsRoot;
  constructor(opts = {}) {
    this.dataDir = resolveDataDir(opts);
    this.docsRoot = opts.docsRoot ?? join9(process.cwd(), "docs");
  }
  /** Read the spec's shipped-work ledger (Decision 70). ENOENT → empty; garbage → LOUD. */
  async ledger(repo, specId) {
    return readLedger(this.dataDir, repo, specId);
  }
  /**
   * Resolve an existing spec for `(repo, issueNumber)` — Δ X reuse. Scans the
   * repo's spec dir for a `spec_id` starting with `<issue>-` and returns its
   * parsed request, else null. The issue number (not the slug) is the lookup
   * key, so a rerun reuses the spec even if the slug would differ on regen.
   *
   * @throws if a matching dir exists but its request/tasks are unreadable or
   *         invalid (a corrupt durable spec is loud, never silently a miss).
   */
  async resolveByIssue(repo, issueNumber) {
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new Error(`resolveByIssue: issue number must be a positive integer, got ${issueNumber}`);
    }
    const repoRoot = join9(specsRoot(this.dataDir), repoKey(repo));
    let entries;
    try {
      entries = await readdir2(repoRoot);
    } catch (err) {
      if (isEnoent(err)) {
        return null;
      }
      throw err;
    }
    const prefix = `${issueNumber}-`;
    const matches = entries.filter((e) => issueOf(e) === issueNumber && e.startsWith(prefix));
    if (matches.length === 0) {
      return null;
    }
    if (matches.length > 1) {
      throw new Error(
        `resolveByIssue: multiple specs for issue #${issueNumber} in ${repo}: ${matches.join(", ")}`
      );
    }
    const specId = at(matches, 0);
    return this.read(repo, specId);
  }
  /**
   * Delete the canonical spec dir for `(repo, issueNumber)`, if one exists.
   * Called by `storeSpec` immediately before writing a spec, so a `--supersede`
   * regeneration replaces the old spec only AFTER the new one passed gate +
   * review (the old spec — and any run pointing at it — survives the whole
   * regen loop). Returns `true` when a dir was deleted, `false` when nothing
   * matched (idempotent — the fresh path matches nothing).
   *
   * @ponytail: only the canonical dataDir spec dir is removed; the in-repo
   * reviewable mirror (`docs/factory/<spec-id>/`) is left in place —
   * `store.write` overwrites it on regen. A slug-change leaves a cosmetic
   * stale mirror dir; not worth working-tree churn for this edge case.
   */
  async deleteByIssue(repo, issueNumber) {
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new Error(`deleteByIssue: issue number must be a positive integer, got ${issueNumber}`);
    }
    const repoRoot = join9(specsRoot(this.dataDir), repoKey(repo));
    let entries;
    try {
      entries = await readdir2(repoRoot);
    } catch (err) {
      if (isEnoent(err)) {
        return false;
      }
      throw err;
    }
    const matches = entries.filter((e) => issueOf(e) === issueNumber);
    if (matches.length === 0) {
      return false;
    }
    for (const specId of matches) {
      await rm2(specDir(this.dataDir, repo, specId), { recursive: true, force: true });
    }
    log18.info(`deleted spec(s) for issue #${issueNumber} in ${repo}: ${matches.join(", ")}`);
    return true;
  }
  /** Read + validate the request for a known `(repo, spec_id)`. */
  async read(repo, specId) {
    const dir = specDir(this.dataDir, repo, specId);
    const tasksRaw = await readFile6(join9(dir, TASKS_FILE), "utf8");
    const tasks = parseSpecTasks(parseJson(tasksRaw, join9(dir, TASKS_FILE)));
    const meta = await this.readMeta(dir);
    return parseSpecManifest({
      spec_id: specId,
      issue_number: issueOf(specId) ?? meta.issue_number,
      slug: specId.replace(/^\d+-/, ""),
      repo,
      generated_at: meta.generated_at,
      tasks
    });
  }
  /**
   * Durably write a spec: `spec.md` + the bare `tasks.json` array. The request
   * header is persisted as a holdout so {@link read} can reconstruct
   * `generated_at` without re-running the generator.
   *
   * F-specloc — also mirrors `spec.md` + the bare `tasks.json` into the in-repo
   * reviewable copy (`<docsRoot>/factory/<spec-id>/`). The mirror is a strict
   * subset (no `spec.meta.json` holdout, no `prd.json` — the PRD is already
   * public on the issue): the holdout is a dataDir reconstruction detail, and
   * the canonical read-path never consults the mirror. Reruns still resolve by
   * issue number against the dataDir store (unchanged).
   *
   * S9 (Decision 47): `prd` is REQUIRED — the durable PRD snapshot is what the
   * traceability stage audits at finalize time (never a `gh` re-fetch: network
   * at the most expensive moment, and a possibly-edited PRD is a TOCTOU audit).
   */
  async write(request, specMd, prd) {
    const parsed = parseSpecManifest(request);
    const dir = specDir(this.dataDir, parsed.repo, parsed.spec_id);
    const tasksJson = stringifyJson(parsed.tasks);
    await atomicWriteFile(join9(dir, SPEC_MD_FILE), specMd);
    await atomicWriteFile(join9(dir, TASKS_FILE), tasksJson);
    await atomicWriteFile(join9(dir, PRD_FILE), stringifyJson(prd));
    await atomicWriteFile(
      join9(dir, META_FILE),
      stringifyJson({
        issue_number: parsed.issue_number,
        slug: parsed.slug,
        repo: parsed.repo,
        generated_at: parsed.generated_at
      })
    );
    const reviewDir = docsFactoryDir(this.docsRoot, parsed.spec_id);
    let mirrored = true;
    try {
      await atomicWriteFile(join9(reviewDir, SPEC_MD_FILE), specMd);
      await atomicWriteFile(join9(reviewDir, TASKS_FILE), tasksJson);
    } catch (err) {
      mirrored = false;
      log18.warn(
        `could not write reviewable copy to ${reviewDir} (${err instanceof Error ? err.message : String(err)}) \u2014 the canonical spec at ${dir} is unaffected; run continues`
      );
    }
    log18.info(
      `wrote spec ${parsed.spec_id} (${parsed.tasks.length} tasks) to ${dir} ` + (mirrored ? `(reviewable copy: ${reviewDir})` : `(reviewable copy SKIPPED \u2014 see warning)`)
    );
    return this.toPointer(parsed);
  }
  /** True iff the durable PRD snapshot exists for `(repo, specId)` — S9. */
  async hasPrd(repo, specId) {
    try {
      await access2(join9(specDir(this.dataDir, repo, specId), PRD_FILE));
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Read the durable PRD snapshot (S9). LOUD with the regenerate remedy when the
   * snapshot is missing — never a silent null (traceability would audit nothing).
   */
  async readPrd(repo, specId) {
    const path7 = join9(specDir(this.dataDir, repo, specId), PRD_FILE);
    let raw;
    try {
      raw = await readFile6(path7, "utf8");
    } catch (err) {
      if (isEnoent(err)) {
        throw new Error(
          `spec ${specId} has no PRD snapshot (created by an older factory version) \u2014 re-run with \`--supersede\` to regenerate the spec`
        );
      }
      throw err;
    }
    return parsePrd(parseJson(raw, path7), path7);
  }
  /** Build the run-facing {@link SpecPointer} from a request. */
  toPointer(request) {
    return {
      repo: request.repo,
      spec_id: request.spec_id,
      issue_number: request.issue_number
    };
  }
  async readMeta(dir) {
    const raw = await readFile6(join9(dir, META_FILE), "utf8");
    const parsed = parseJson(raw, join9(dir, META_FILE));
    const meta = parsed !== null && typeof parsed === "object" ? parsed : {};
    const issueNumber = typeof meta.issue_number === "number" ? meta.issue_number : 0;
    const generatedAt = typeof meta.generated_at === "string" ? meta.generated_at : "";
    if (generatedAt.length === 0) {
      throw new Error(`spec meta at ${dir} is missing generated_at`);
    }
    return { issue_number: issueNumber, generated_at: generatedAt };
  }
};
var META_FILE = "spec.meta.json";

// src/spec/agents.ts
var APEX_MODEL = "opus";
var APEX_EFFORT = "xhigh";
var GenerateResultSchema = external_exports.object({
  specMd: external_exports.string().min(1),
  slug: external_exports.string().min(1),
  tasks: SpecTasksSchema
}).strict();
function parseGenerateResult(raw) {
  return GenerateResultSchema.parse(raw);
}
function buildGenerateSpawn(prd) {
  return {
    role: "spec-generator",
    agent_type: SPEC_GENERATOR_AGENT_TYPE,
    model: APEX_MODEL,
    effort: APEX_EFFORT,
    context: {
      issue_number: prd.issue_number,
      title: prd.title,
      body: prd.body,
      labels: prd.labels
    }
  };
}
function buildReviseSpawn(prd, prior, feedback) {
  const base = buildGenerateSpawn(prd);
  return {
    ...base,
    context: {
      ...base.context,
      prior_spec_md: prior.specMd,
      prior_tasks: prior.tasks,
      review_feedback: feedback
    }
  };
}
function buildReviewSpawn(prd, generated) {
  return {
    role: "spec-reviewer",
    agent_type: SPEC_REVIEWER_AGENT_TYPE,
    model: APEX_MODEL,
    effort: APEX_EFFORT,
    context: {
      issue_number: prd.issue_number,
      prd_body: prd.body,
      spec_md: generated.specMd,
      tasks: generated.tasks
    }
  };
}

// src/spec/gates.ts
function combineGates(...results) {
  const blockers = results.flatMap((r) => r.blockers);
  return { passed: blockers.length === 0, blockers };
}
var MIN_PRD_BODY_CHARS = 200;
var AC_SECTION_HEADING = /^(acceptance[ -]criteria|acceptance[ -]tests?|success[ -]criteria|definition[ -]of[ -]done)\b/i;
function specifiabilityGate(body) {
  const blockers = [];
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const content = lines.filter((l) => l.length > 0 && !/^#{1,6}\s/.test(l)).join("\n");
  if (content.length < MIN_PRD_BODY_CHARS) {
    blockers.push(
      `specifiability: PRD body is trivial (${content.length} chars of content, minimum ${MIN_PRD_BODY_CHARS}) \u2014 describe the problem, the desired behavior, and constraints`
    );
  }
  if (extractPrdRequirements(body).length === 0) {
    blockers.push(
      "specifiability: no extractable requirements \u2014 add bulleted requirements or normative (must/should) sentences outside Out-of-Scope/Non-Goals sections"
    );
  }
  const hasAcSection = lines.some((l) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(l);
    return heading !== null && AC_SECTION_HEADING.test(nonNull(heading[1]).trim());
  });
  if (!hasAcSection && !hasNestedCriteriaShape(body)) {
    blockers.push(
      'specifiability: no acceptance-criteria-shaped section and no nested per-requirement criteria \u2014 add an "## Acceptance Criteria" (or Definition of Done / Success Criteria) section, or nest testable criteria as sub-bullets under each requirement'
    );
  }
  return { passed: blockers.length === 0, blockers };
}
function hasNestedCriteriaShape(body) {
  let skipLevel = null;
  let parentIndent = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = nonNull(heading[1]).length;
      if (skipLevel !== null && level <= skipLevel) {
        skipLevel = null;
      }
      if (EXCLUDED_SECTION_HEADING.test(nonNull(heading[2]).trim())) {
        skipLevel = level;
      }
      parentIndent = null;
      continue;
    }
    if (skipLevel !== null) {
      continue;
    }
    const item = /^(\s*)(?:[-*+]|\d+[.)])\s+\S/.exec(raw);
    if (!item) {
      continue;
    }
    const indent = nonNull(item[1]).length;
    if (parentIndent !== null && indent > parentIndent) {
      return true;
    }
    parentIndent = indent;
  }
  return false;
}
var HORIZONTAL_MARKERS = [
  "schema",
  "database",
  "migration",
  "model",
  "models",
  "backend",
  "frontend",
  "ui",
  "api layer",
  "data layer",
  "service layer",
  "controllers",
  "routes",
  "styling",
  "css",
  "types",
  "interfaces",
  "tests"
];
function looksHorizontal(title) {
  const t = title.trim().toLowerCase();
  if (t.split(/\s+/).length > 4) {
    return false;
  }
  return HORIZONTAL_MARKERS.some((m) => t === m || t.startsWith(m + " ") || t.endsWith(" " + m));
}
function verticalSliceGate(tasks) {
  if (tasks.length <= 1) {
    return { passed: true, blockers: [] };
  }
  const horizontal = tasks.filter((t) => looksHorizontal(t.title));
  if (horizontal.length === tasks.length) {
    return {
      passed: false,
      blockers: [
        `vertical-slice: decomposition is purely horizontal \u2014 every task is a layer (${horizontal.map((t) => t.task_id).join(", ")}); slice by end-to-end feature instead`
      ]
    };
  }
  return { passed: true, blockers: [] };
}
var VAGUE_MARKERS = [
  "works well",
  "works correctly",
  "works properly",
  "as expected",
  "user-friendly",
  "easy to use",
  "intuitive",
  "fast enough",
  "performant",
  "good performance",
  "robust",
  "reliable",
  "handle errors gracefully",
  "looks good",
  "high quality",
  "etc.",
  "and so on"
];
function keywords(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4)
  );
}
function isVague(criterion) {
  const c = criterion.trim().toLowerCase();
  if (c.length < 8) {
    return true;
  }
  return VAGUE_MARKERS.some((m) => c.includes(m));
}
function hasCoveringTest(criterion, tests) {
  const ck = keywords(criterion);
  if (ck.size === 0) {
    return false;
  }
  return tests.some((t) => {
    const tk = keywords(t);
    for (const w of ck) {
      if (tk.has(w)) {
        return true;
      }
    }
    return false;
  });
}
function testabilityGate(tasks) {
  const blockers = [];
  for (const task of tasks) {
    for (const criterion of task.acceptance_criteria) {
      if (isVague(criterion)) {
        blockers.push(`testability: task ${task.task_id} has a vague/non-actionable criterion: "${criterion}"`);
        continue;
      }
      if (!hasCoveringTest(criterion, task.tests_to_write)) {
        blockers.push(
          `testability: task ${task.task_id} criterion "${criterion}" has no covering tests_to_write entry`
        );
      }
    }
  }
  return { passed: blockers.length === 0, blockers };
}
var EXCLUDED_SECTION_HEADING = /^(out[ -]of[ -]scope|non[- ]?goals?|not doing|won'?t do)\b/i;
function extractPrdRequirements(body) {
  const lines = body.split(/\r?\n/);
  const reqs = [];
  let skipLevel = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = nonNull(heading[1]).length;
      if (skipLevel !== null && level <= skipLevel) {
        skipLevel = null;
      }
      if (EXCLUDED_SECTION_HEADING.test(nonNull(heading[2]).trim())) {
        skipLevel = level;
      }
      continue;
    }
    if (skipLevel !== null) {
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    const bulletBody = bullet?.[1];
    if (bulletBody != null && bulletBody.trim().length > 0) {
      reqs.push(bulletBody.trim());
      continue;
    }
    if (/\b(must|shall|should|need to|required to)\b/i.test(line) && !line.startsWith("#")) {
      reqs.push(line);
    }
  }
  return reqs;
}
function requirementCovered(requirement, allCriteria) {
  const rk = keywords(requirement);
  if (rk.size === 0) {
    return true;
  }
  return allCriteria.some((c) => {
    const ck = keywords(c);
    let shared = 0;
    for (const w of rk) {
      if (ck.has(w)) {
        shared++;
      }
    }
    return shared >= Math.min(2, rk.size);
  });
}
function taskLaddersToPrd(task, requirements) {
  const text = [task.title, task.description, ...task.acceptance_criteria].join(" ");
  const tk = keywords(text);
  if (requirements.length === 0) {
    return false;
  }
  return requirements.some((r) => {
    const rk = keywords(r);
    for (const w of rk) {
      if (tk.has(w)) {
        return true;
      }
    }
    return false;
  });
}
function traceabilityGate(prd, tasks) {
  const requirements = extractPrdRequirements(prd.body);
  const allCriteria = tasks.flatMap((t) => t.acceptance_criteria);
  const blockers = [];
  if (requirements.length === 0) {
    blockers.push(
      `traceability: PRD #${prd.issue_number} yielded no extractable requirements \u2014 cannot verify the spec covers it (PRD is the axiom)`
    );
    return { passed: false, blockers };
  }
  for (const req of requirements) {
    if (!requirementCovered(req, allCriteria)) {
      blockers.push(`traceability: PRD requirement has no covering acceptance criterion: "${req}"`);
    }
  }
  for (const task of tasks) {
    if (!taskLaddersToPrd(task, requirements)) {
      blockers.push(`traceability: task ${task.task_id} ("${task.title}") does not ladder to any PRD requirement`);
    }
  }
  return { passed: blockers.length === 0, blockers };
}
function runSpecGates(prd, tasks) {
  return combineGates(verticalSliceGate(tasks), testabilityGate(tasks), traceabilityGate(prd, tasks));
}

// src/spec/review.ts
var REVIEW_DIMENSION_COUNT = 6;
var REVIEW_MAX_TOTAL = REVIEW_DIMENSION_COUNT * 10;
var dimScore = external_exports.number().int().min(1).max(10);
var PerDimensionSchema = external_exports.object({
  granularity: dimScore,
  dependencies: dimScore,
  acceptance_criteria: dimScore,
  tests: dimScore,
  vertical_slices: dimScore,
  alignment: dimScore
}).strict();
var ReviewVerdictSchema = external_exports.object({
  decision: external_exports.enum(["PASS", "NEEDS_REVISION"]),
  score: external_exports.number().int().min(0).max(REVIEW_MAX_TOTAL),
  per_dimension: PerDimensionSchema,
  blockers: external_exports.array(external_exports.string()).default([]),
  concerns: external_exports.array(external_exports.string()).default([])
}).strict();
function parseReviewVerdict(raw) {
  return ReviewVerdictSchema.parse(raw);
}
function decideSpecReview(verdict, opts = {}) {
  const threshold = opts.passReviewThreshold ?? SPEC_DEFAULTS.passReviewThreshold;
  const floor = opts.dimensionFloor ?? SPEC_DEFAULTS.dimensionFloor;
  const dims = verdict.per_dimension;
  const total = dims.granularity + dims.dependencies + dims.acceptance_criteria + dims.tests + dims.vertical_slices + dims.alignment;
  const floorFailures = Object.entries(dims).filter(([, v]) => v <= floor).map(([k]) => k);
  if (floorFailures.length > 0) {
    return {
      decision: "NEEDS_REVISION",
      total,
      floorFailures,
      reason: `auto-fail floor tripped: dimension(s) ${floorFailures.join(", ")} scored <= ${floor} (total ${total}/${REVIEW_MAX_TOTAL})`
    };
  }
  if (total >= threshold) {
    return {
      decision: "PASS",
      total,
      floorFailures: [],
      reason: `total ${total}/${REVIEW_MAX_TOTAL} >= threshold ${threshold}`
    };
  }
  return {
    decision: "NEEDS_REVISION",
    total,
    floorFailures: [],
    reason: `total ${total}/${REVIEW_MAX_TOTAL} < threshold ${threshold}`
  };
}

// src/spec/build.ts
import { join as join10 } from "node:path";
var PRD_FILE2 = "prd.json";
var GENERATED_FILE = "generated.json";
var VERDICT_FILE = "verdict.json";
var ATTEMPTS_FILE = "attempts.json";
function scratchPaths(scratchRoot, repo, issue) {
  const dir = specBuildDir(scratchRoot, repo, issue);
  return {
    prdPath: join10(dir, PRD_FILE2),
    generatedPath: join10(dir, GENERATED_FILE),
    verdictPath: join10(dir, VERDICT_FILE),
    attemptsPath: join10(dir, ATTEMPTS_FILE)
  };
}
async function readAttempts(attemptsPath) {
  try {
    const raw = await readJsonFile(attemptsPath);
    const n = raw.iterations;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
async function consumeRegenOrDefect(deps, repo, issue, { source, blockers }) {
  const { attemptsPath } = scratchPaths(deps.scratchRoot, repo, issue);
  const max = deps.config.spec.maxRegenIterations;
  const prior = await readAttempts(attemptsPath);
  if (prior >= max) {
    const stage = source === "gate" ? "the deterministic gates" : "review";
    return {
      kind: "spec-defect",
      repo,
      issue,
      source,
      iterations: prior,
      max_iterations: max,
      reason: `spec regeneration bound exhausted (${prior}/${max}) \u2014 the spec never passed ${stage}; the PRD likely needs rework`,
      blockers
    };
  }
  await atomicWriteFile(attemptsPath, stringifyJson({ iterations: prior + 1 }));
  return null;
}
async function quotaPause(deps, repo, issue, ignoreQuota) {
  if (ignoreQuota) {
    return null;
  }
  const decision = evaluate(await deps.usage.read(), deps.config, deps.now());
  if (decision.kind === "proceed") {
    return null;
  }
  return {
    kind: "pause",
    repo,
    issue,
    scope: decision.kind === "pause-5h" ? "5h" : decision.kind === "suspend-7d" ? "7d" : "unavailable",
    reason: decision.reason,
    ...decision.kind === "unavailable-halt" ? {} : { resets_at_epoch: decision.resetsAtEpoch }
  };
}
async function resolveSpec(deps, repo, issue, { regenerate = false, ignoreQuota = false } = {}) {
  if (!regenerate) {
    const existing = await deps.store.resolveByIssue(repo, issue);
    if (existing) {
      return { kind: "reuse", repo, issue, pointer: deps.store.toPointer(existing) };
    }
  }
  const prd = await deps.gh.fetchPrd(issue, { repo });
  const { prdPath, generatedPath, attemptsPath } = scratchPaths(deps.scratchRoot, repo, issue);
  await atomicWriteFile(prdPath, stringifyJson(prd));
  const specifiability = specifiabilityGate(prd.body);
  if (!specifiability.passed) {
    return {
      kind: "unspecifiable",
      repo,
      issue,
      prd_path: prdPath,
      blockers: specifiability.blockers
    };
  }
  const pause = await quotaPause(deps, repo, issue, ignoreQuota);
  if (pause) {
    return pause;
  }
  await atomicWriteFile(attemptsPath, stringifyJson({ iterations: 0 }));
  return {
    kind: "generate",
    repo,
    issue,
    spawn: buildGenerateSpawn(prd),
    prd_path: prdPath,
    generated_path: generatedPath,
    max_iterations: deps.config.spec.maxRegenIterations
  };
}
async function gateSpec(deps, repo, issue) {
  const { prdPath, generatedPath, verdictPath } = scratchPaths(deps.scratchRoot, repo, issue);
  const prd = await readJsonFile(prdPath);
  const generated = parseGenerateResult(await readJsonFile(generatedPath));
  const gates = runSpecGates(prd, generated.tasks);
  if (!gates.passed) {
    const defect = await consumeRegenOrDefect(deps, repo, issue, { source: "gate", blockers: gates.blockers });
    if (defect) {
      return defect;
    }
    return {
      kind: "revise",
      repo,
      issue,
      source: "gate",
      reason: "deterministic spec gates blocked the spec",
      blockers: gates.blockers,
      // review_feedback derives from these same blockers — single source, no divergence.
      spawn: buildReviseSpawn(prd, generated, gates.blockers),
      generated_path: generatedPath
    };
  }
  return {
    kind: "review",
    repo,
    issue,
    spawn: buildReviewSpawn(prd, generated),
    generated_path: generatedPath,
    verdict_path: verdictPath
  };
}
async function storeSpec(deps, repo, issue) {
  const { prdPath, generatedPath, verdictPath } = scratchPaths(deps.scratchRoot, repo, issue);
  const generated = parseGenerateResult(await readJsonFile(generatedPath));
  const verdict = parseReviewVerdict(await readJsonFile(verdictPath));
  const decision = decideSpecReview(verdict, {
    passReviewThreshold: deps.config.spec.passReviewThreshold,
    dimensionFloor: deps.config.spec.dimensionFloor
  });
  if (decision.decision === "NEEDS_REVISION") {
    const blockers = verdict.blockers.length > 0 ? verdict.blockers : [decision.reason];
    const defect = await consumeRegenOrDefect(deps, repo, issue, { source: "review", blockers });
    if (defect) {
      return defect;
    }
    const prd2 = await readJsonFile(prdPath);
    return {
      kind: "revise",
      repo,
      issue,
      source: "review",
      reason: decision.reason,
      blockers,
      spawn: buildReviseSpawn(prd2, generated, blockers),
      generated_path: generatedPath
    };
  }
  const request = buildManifest(repo, issue, generated);
  const prd = await readJsonFile(prdPath);
  await deps.store.deleteByIssue(repo, issue);
  const pointer = await deps.store.write(request, generated.specMd, prd);
  return { kind: "stored", repo, issue, pointer };
}
function buildManifest(repo, issueNumber, generated) {
  const specId = makeSpecId(issueNumber, generated.slug);
  const slug = specId.replace(/^\d+-/, "");
  return parseSpecManifest({
    spec_id: specId,
    issue_number: issueNumber,
    slug,
    repo,
    generated_at: nowIso(),
    tasks: generated.tasks
  });
}

// src/producer/agents.ts
function parseProducerStatus(raw) {
  const line = raw.trim();
  const upper = line.toUpperCase();
  if (upper.includes("BLOCKED") && upper.includes("ESCALATE")) {
    if (upper.includes("TEST REQUIRES REVISION")) {
      return { status: "test-defective", reason: line };
    }
    return { status: "blocked-escalate", reason: line };
  }
  if (upper.includes("ALREADY_SATISFIED") || upper.includes("ALREADY SATISFIED")) {
    const shas = line.match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
    return { status: "already-satisfied", shas, reason: line };
  }
  if (upper.includes("NEEDS_CONTEXT") || upper.includes("NEEDS CONTEXT")) {
    return { status: "needs-context", reason: line };
  }
  if (/^(?:STATUS\s*:\s*)?DONE(?:_WITH_CONCERNS)?\b/.test(upper)) {
    return { status: "done" };
  }
  return {
    status: "error",
    reason: line.length > 0 ? `unparseable producer status: ${line}` : "empty producer status"
  };
}

// src/producer/model-dial.ts
var EFFORT_LADDER = ["xhigh", "max"];
function dialForRung(riskTier, rung, config) {
  if (rung < 0 || !Number.isInteger(rung)) {
    throw new Error(`dialForRung: rung must be a non-negative integer, got ${rung}`);
  }
  const baseModel = selectProducerModel(riskTier, config);
  if (rung <= 1) {
    return { model: baseModel, rung, injectsPriorFailure: false };
  }
  const ceilingModel = selectProducerModel("high", config);
  const effortSteps = EFFORT_LADDER.map((effort) => ({
    model: ceilingModel,
    effort
  }));
  const steps = baseModel === ceilingModel ? effortSteps : [{ model: ceilingModel }, ...effortSteps];
  const step = steps[Math.min(rung - 2, steps.length - 1)];
  if (step === void 0) {
    throw new Error(`dialForRung: no escalation step for rung ${rung}`);
  }
  return {
    model: step.model,
    rung,
    injectsPriorFailure: true,
    ...step.effort !== void 0 ? { effort: step.effort } : {}
  };
}

// src/producer/prompt-context.ts
function toFixInstruction(f) {
  const base = { reviewer: f.reviewer, description: f.description };
  if (f.file !== void 0 && f.line !== void 0) {
    return { ...base, file: f.file, line: f.line };
  }
  if (f.file !== void 0) {
    return { ...base, file: f.file };
  }
  return base;
}
function buildProducerContext(input) {
  const fixInstructions = (input.confirmedBlockers ?? []).map(toFixInstruction);
  const priorFailures = input.priorFailures ?? [];
  return {
    taskId: input.taskId,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.visibleCriteria,
    files: input.files,
    rung: input.rung,
    fixInstructions,
    priorFailures,
    injectedPriorFailure: priorFailures.length > 0,
    designSystemDocs: input.designSystemDocs ?? [],
    testsToWrite: input.testsToWrite ?? []
  };
}
function renderProducerPrompt(ctx, worktree) {
  const lines = [
    `Task ${ctx.taskId}: ${ctx.title}`,
    "",
    ctx.description,
    "",
    "Acceptance criteria:",
    ...ctx.acceptanceCriteria.map((c) => `- ${c}`)
  ];
  if (ctx.testsToWrite.length > 0) {
    lines.push("", "Tests to write:", ...ctx.testsToWrite.map((t) => `- ${t}`));
  }
  if (ctx.files.length > 0) {
    lines.push("", "Scoped files:", ...ctx.files.map((f) => `- ${f}`));
  }
  if (ctx.designSystemDocs.length > 0) {
    lines.push(
      "",
      `Design system: this repo documents a design system at ${ctx.designSystemDocs.join(", ")}. Read it BEFORE writing any UI code and follow its tokens/components/conventions.`
    );
  }
  if (ctx.fixInstructions.length > 0) {
    lines.push("", "Confirmed blockers to fix (patch forward, do not nuke prior work):");
    for (const fi of ctx.fixInstructions) {
      const loc = fi.file !== void 0 ? fi.line !== void 0 ? ` (${fi.file}:${fi.line})` : ` (${fi.file})` : "";
      lines.push(`- [${fi.reviewer}]${loc} ${fi.description}`);
    }
  }
  if (ctx.priorFailures.length > 0) {
    lines.push("", "Prior failures \u2014 don't repeat these:");
    for (const pf of ctx.priorFailures) {
      lines.push(`- rung ${pf.rung}: ${pf.summary}`);
    }
  }
  lines.push(
    "",
    `Your working tree is ${worktree} (already checked out on the task branch). cd there; make ALL commits there.`
  );
  return lines.join("\n");
}

// src/producer/classify.ts
function exhaustive(x) {
  throw new Error(`classify: unhandled FailureSignal ${JSON.stringify(x)}`);
}
function classifyFailure(signal) {
  switch (signal.kind) {
    case "producer-status": {
      if (signal.status === "blocked-escalate") {
        return {
          action: "fail",
          failureClass: "spec-defect",
          reason: `producer reported the task unworkable as specified: ${signal.reason}`
        };
      }
      return { action: "retry", reason: `RED test reported defective: ${signal.reason}` };
    }
    case "gate-failure": {
      if (signal.structurallyUnfixable) {
        return {
          action: "fail",
          failureClass: "spec-defect",
          reason: `deterministic gate '${signal.gate}' is structurally unfixable by the producer: ${signal.reason}`
        };
      }
      return { action: "retry", reason: `gate '${signal.gate}' failed: ${signal.reason}` };
    }
    case "environmental": {
      return {
        action: "fail",
        failureClass: "blocked-environmental",
        reason: `environmental blocker: ${signal.reason}`
      };
    }
    case "verifier-error": {
      return { action: "retry", reason: `verifier error (unresolved): ${signal.reason}` };
    }
    case "merge-gate-blocked": {
      return { action: "retry", reason: signal.reason };
    }
    default:
      return exhaustive(signal);
  }
}

// src/producer/escalation.ts
var ESCALATION_CAP = 4;

// src/verifier/deterministic/strategy.ts
function ran(gate, observed, detail) {
  const evidence = detail === void 0 ? { gate, observed } : { gate, observed, detail };
  return { kind: "ran", evidence };
}
function skip(gate, reason) {
  return { kind: "skip", gate, reason };
}

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
function isDocsPath(file) {
  if (file.startsWith("docs/")) {
    return true;
  }
  if (file.endsWith(".md")) {
    return true;
  }
  return false;
}
function isMutableSrc(file, roots = ["src"]) {
  if (!file.endsWith(".ts") || !roots.some((r) => file.startsWith(r + "/"))) {
    return false;
  }
  if (/\.(test|spec|d)\.ts$/.test(file)) {
    return false;
  }
  if (file.includes("/types/")) {
    return false;
  }
  if (file.includes("/data/")) {
    return false;
  }
  if (/(^|\/)index\.ts$/.test(file)) {
    return false;
  }
  return true;
}
function mutationScope(changedFiles, roots = ["src"]) {
  return filterDedup(changedFiles, (f) => isMutableSrc(f, roots));
}
function diffScopedTestFiles(changedFiles) {
  return filterDedup(changedFiles, isTestPath);
}
function escapeStrykerGlob(p) {
  return p.replace(/[[\]{}()*?!+@|]/g, (c) => `[${c}]`);
}
function filterDedup(files, keep) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const f of files) {
    if (!keep(f)) {
      continue;
    }
    if (seen.has(f)) {
      continue;
    }
    seen.add(f);
    out.push(f);
  }
  return out;
}

// src/verifier/deterministic/strategies/proc-strategy.ts
var EXCERPT_MAX_CHARS = 1e3;
function excerpt(text) {
  const trimmed = redactSecrets(text).trim();
  if (trimmed.length <= EXCERPT_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, EXCERPT_MAX_CHARS)}\u2026 (truncated)`;
}
function procOutcome(id, label, result) {
  if (result.truncated) {
    throw new Error(`${id} gate: ${label} output truncated \u2014 refusing to judge a clipped run`);
  }
  const base = `${label} exit=${result.code ?? "null"}`;
  if (result.code === 0) {
    return ran(id, true, base);
  }
  const output = excerpt(result.stderr || result.stdout);
  return ran(id, false, output ? `${base}: ${output}` : base);
}
function procStrategy(id, label, invoke) {
  return {
    id,
    async run(ctx) {
      const opts = { cwd: ctx.worktree };
      const command = contractCommand(ctx.contract, id);
      if (command !== void 0) {
        return procOutcome(id, `contract:${command.join(" ")}`, await ctx.tools.command.run(command, opts));
      }
      return procOutcome(id, label, await invoke(ctx.tools, opts));
    }
  };
}

// src/verifier/deterministic/strategies/test.ts
function isVitestRunnable(file) {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && !file.endsWith(".d.ts");
}
var testStrategy = {
  id: "test",
  async run(ctx) {
    const command = contractCommand(ctx.contract, "test");
    if (command !== void 0) {
      return procOutcome(
        "test",
        `contract:${command.join(" ")}`,
        await ctx.tools.command.run(command, { cwd: ctx.worktree })
      );
    }
    const base = `origin/${ctx.baseRef}`;
    const changed = await ctx.tools.git.changedFiles(base, { cwd: ctx.worktree });
    const scoped = diffScopedTestFiles(changed);
    const runnable = scoped.filter(isVitestRunnable);
    if (scoped.length > 0 && runnable.length === 0) {
      return skip("test", "no-vitest-runnable-tests-in-scope");
    }
    const result = await ctx.tools.vitest.run(runnable, { cwd: ctx.worktree });
    if (result.truncated) {
      throw new Error("test gate: vitest output truncated \u2014 refusing to judge a clipped run");
    }
    const observed = result.code === 0;
    const skipped = scoped.length - runnable.length;
    const scope = runnable.length > 0 ? `diff-scoped (${runnable.length} test file(s))` : "un-scoped";
    const detail = `vitest exit=${result.code ?? "null"} ${scope}` + (skipped > 0 ? `; ${skipped} non-vitest file(s) not executed` : "");
    if (observed) {
      return ran("test", true, detail);
    }
    const output = excerpt(result.stdout || result.stderr);
    return ran("test", false, output ? `${detail}: ${output}` : detail);
  }
};

// src/verifier/deterministic/tdd-classify.ts
function classifyCommit(files) {
  const real = files.filter((f) => f.length > 0);
  if (real.length === 0) {
    return "empty";
  }
  let kind = "test-only";
  for (const f of real) {
    if (!isTestPath(f) && !isDocsPath(f)) {
      kind = "impl";
    }
  }
  return kind;
}
function deriveTddVerdict(commits, exempt) {
  if (commits.length === 0) {
    return {
      ok: false,
      exempt: false,
      violations: [],
      note: "no commits in base..HEAD \u2014 fail-closed (implementer produced nothing)"
    };
  }
  const classed = commits.map((c) => ({
    sha: c.sha,
    kind: classifyCommit(c.files),
    tagged: c.tagged
  }));
  const hasImpl = classed.some((c) => c.kind === "impl");
  if (!hasImpl) {
    return { ok: true, exempt: false, violations: [], note: "no impl commit (tests/docs only)" };
  }
  if (exempt) {
    return { ok: true, exempt: true, violations: [], note: "task tdd_exempt" };
  }
  let seenTestOnly = false;
  const violations = [];
  for (const c of classed) {
    if (c.kind === "test-only" && c.tagged) {
      seenTestOnly = true;
    } else if (c.kind === "impl") {
      if (!c.tagged) {
        violations.push({ commit: c.sha, reason: "impl-commit-untagged" });
      } else if (!seenTestOnly) {
        violations.push({ commit: c.sha, reason: "impl-without-preceding-test" });
      }
    }
  }
  if (violations.length > 0) {
    return { ok: false, exempt: false, violations, note: "tdd ordering violation(s)" };
  }
  return { ok: true, exempt: false, violations: [], note: "test-before-impl satisfied" };
}

// src/verifier/deterministic/strategies/tdd.ts
function isSquashedHistory(commitFiles) {
  if (commitFiles.length !== 1) {
    return false;
  }
  const files = at(commitFiles, 0);
  const hasTest = files.some((f) => isTestPath(f));
  const hasImpl = files.some((f) => !isTestPath(f) && !f.endsWith(".md") && !f.startsWith("docs/"));
  return hasTest && hasImpl;
}
async function resolveBase(tools, baseRef, opts) {
  const remote = `origin/${baseRef}`;
  if (await tools.git.refExists(remote, opts)) {
    return remote;
  }
  if (await tools.git.refExists(baseRef, opts)) {
    return baseRef;
  }
  return null;
}
function verdictToOutcome(verdict) {
  const detail = verdict.violations.length > 0 ? `${verdict.note}: ${verdict.violations.map((v) => `${v.reason}@${v.commit}`).join(", ")}` : `${verdict.note}${verdict.exempt ? " (exempt)" : ""}`;
  return ran("tdd", verdict.ok, detail);
}
var tddStrategy = {
  id: "tdd",
  async run(ctx) {
    const opts = { cwd: ctx.worktree };
    const base = await resolveBase(ctx.tools, ctx.baseRef, opts);
    if (base === null) {
      return ran("tdd", false, `base_ref_not_found: origin/${ctx.baseRef} and ${ctx.baseRef}`);
    }
    const commits = await ctx.tools.git.commits(base, ctx.taskId, opts);
    if (isSquashedHistory(commits.map((c) => c.files))) {
      const verdict2 = {
        ok: true,
        exempt: false,
        violations: [],
        note: "squashed history \u2014 TDD gate no-op"
      };
      return verdictToOutcome(verdict2);
    }
    const exempt = ctx.exemptReader ? await ctx.exemptReader.isExempt(ctx.taskId) : false;
    const verdict = deriveTddVerdict(commits, exempt);
    return verdictToOutcome(verdict);
  }
};

// src/verifier/deterministic/strategies/coverage.ts
var METRICS = ["lines", "branches", "functions", "statements"];
function round2(x) {
  return Math.round(x * 100) / 100;
}
function coverageDelta(before, after) {
  return {
    lines: round2(after.lines - before.lines),
    branches: round2(after.branches - before.branches),
    functions: round2(after.functions - before.functions),
    statements: round2(after.statements - before.statements)
  };
}
function regressions(delta, tolerance) {
  const threshold = -1 * tolerance;
  return METRICS.filter((m) => delta[m] < threshold);
}
var COVERAGE_FLAGS = [
  "--coverage.enabled=true",
  "--coverage.reporter=json-summary",
  "--coverage.reportsDirectory=coverage"
];
function resolveCoverageCommand(contract) {
  const override = contractCommand(contract, "coverage");
  if (override !== void 0) {
    return { ok: true, cmd: { kind: "argv", argv: override } };
  }
  const test = contractCommand(contract, "test");
  if (test === void 0) {
    return { ok: true, cmd: { kind: "vitest", args: ["run", ...COVERAGE_FLAGS] } };
  }
  if (test[0] !== "vitest") {
    return {
      ok: false,
      reason: `cannot derive a coverage command from contracted test command '${test.join(" ")}' \u2014 contract gates.coverage.command (it must write coverage/coverage-summary.json) or waive the coverage gate`
    };
  }
  const tail = test.slice(1);
  const args = tail[0] === "run" ? tail : ["run", ...tail];
  return { ok: true, cmd: { kind: "vitest", args: [...args, ...COVERAGE_FLAGS] } };
}
function measurementFailure(which, m) {
  switch (m.kind) {
    case "command-failed": {
      const out = excerpt(m.proc.stderr || m.proc.stdout);
      return `coverage measurement (${which}): command failed exit=${m.proc.code ?? "null"}` + (out ? `: ${out}` : "");
    }
    case "summary-missing":
      return `coverage measurement (${which}): command exited 0 but wrote no coverage/coverage-summary.json`;
    case "summary-invalid":
      return `coverage measurement (${which}): coverage/coverage-summary.json invalid (corrupt or missing a metric)`;
  }
}
async function summaryFor(ctx, which, treeSha, measure) {
  const cached = await ctx.coverageStore?.get(treeSha);
  if (cached != null) {
    return cached;
  }
  const m = await measure();
  if (m.kind !== "measured") {
    return { failed: measurementFailure(which, m) };
  }
  await ctx.coverageStore?.put(treeSha, m.summary);
  return m.summary;
}
var coverageStrategy = {
  id: "coverage",
  async run(ctx) {
    const opts = { cwd: ctx.worktree };
    if (ctx.contract === void 0) {
      throw new Error("coverage strategy invoked without a gate contract \u2014 the runner must load it first");
    }
    const resolution = resolveCoverageCommand(ctx.contract);
    if (!resolution.ok) {
      return ran("coverage", false, resolution.reason);
    }
    const base = await resolveBase(ctx.tools, ctx.baseRef, opts);
    if (base === null) {
      return ran("coverage", false, `base_ref_not_found: origin/${ctx.baseRef} and ${ctx.baseRef}`);
    }
    const headTree = await ctx.tools.git.treeSha(opts);
    const baseSha = await ctx.tools.git.revParse(base, opts);
    const baseTree = await ctx.tools.git.revParse(`${base}^{tree}`, opts);
    const head = await summaryFor(ctx, "head", headTree, () => ctx.tools.coverage.measure(resolution.cmd, opts));
    if ("failed" in head) {
      return ran("coverage", false, head.failed);
    }
    const before = await summaryFor(
      ctx,
      `base ${baseSha}`,
      baseTree,
      () => ctx.tools.coverage.measureAtBase(baseSha, resolution.cmd, opts)
    );
    if ("failed" in before) {
      return ran(
        "coverage",
        false,
        `${before.failed} \u2014 base is measured under head's node_modules; if this task changed deps, contract gates.coverage.command or waive coverage`
      );
    }
    const tolerance = ctx.config.quality.coverageRegressionTolerancePct;
    const delta = coverageDelta(before, head);
    const failed = regressions(delta, tolerance);
    if (failed.length > 0) {
      const named = failed.map((m) => `${m} (${delta[m]}%)`).join(", ");
      return ran("coverage", false, `coverage decreased beyond ${tolerance}%: ${named}`);
    }
    return ran("coverage", true, `coverage within tolerance ${tolerance}%`);
  }
};

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

// src/verifier/deterministic/strategies/mutation.ts
function scorePasses(score, target) {
  return score >= target;
}
var STRYKER_CONFIGS = STRYKER_CONFIG_BASENAMES;
var STRYKER_BIN = "node_modules/.bin/stryker";
var mutationStrategy = {
  id: "mutation",
  async run(ctx) {
    const target = ctx.config.quality.mutationScoreTarget;
    const opts = { cwd: ctx.worktree };
    if (!await ctx.tools.fs.exists(STRYKER_BIN, opts)) {
      return skip("mutation", "no-mutation-binary");
    }
    if (!await ctx.tools.fs.existsAny(STRYKER_CONFIGS, opts)) {
      return skip("mutation", "no-mutation-config");
    }
    const base = `origin/${ctx.baseRef}`;
    if (!await ctx.tools.git.refExists(base, opts)) {
      return ran("mutation", false, `base-missing: ${base} not found`);
    }
    const changed = await ctx.tools.git.changedFiles(base, opts);
    const scope = mutationScope(changed, mutationRoots(ctx.contract));
    if (scope.length === 0) {
      return skip("mutation", "no-mutable-changes");
    }
    const result = await ctx.tools.stryker.run(scope, opts);
    if (result.proc.truncated) {
      throw new Error("mutation gate: stryker report truncated \u2014 refusing to parse a clipped payload");
    }
    const report = result.report;
    if (report.report === "present" && report.mutationScore !== null) {
      const score = report.mutationScore;
      return scorePasses(score, target) ? ran("mutation", true, `mutation score ${score} >= ${target} (scope ${scope.length})`) : ran("mutation", false, `score-below-target: ${score} < ${target}`);
    }
    if (result.proc.code !== 0) {
      return ran("mutation", false, `stryker-failed: exit=${result.proc.code ?? "null"}`);
    }
    if (report.report === "absent") {
      return ran("mutation", false, "no-report: stryker produced no report despite mutable files");
    }
    if (report.report === "unparseable") {
      return ran("mutation", false, "unparseable-report: stryker report JSON did not parse");
    }
    return ran("mutation", false, "no-score: report has no derivable mutation score");
  }
};

// src/verifier/deterministic/strategies/sast.ts
function isAllowedSecurityRunner(argv) {
  const runner = runnerName(argv);
  const a1 = argv[1];
  const a2 = argv[2];
  switch (runner) {
    case "semgrep":
    case "pytest":
    case "vitest":
    case "jest":
    case "mocha":
    case "phpunit":
    case "rspec":
      return true;
    case "go":
    case "cargo":
    case "deno":
      return a1 === "test";
    case "bundle":
      return a1 === "exec" && a2 === "rspec";
    default:
      return false;
  }
}
function validateSecurityCommand(command) {
  return validateCommand(command, isAllowedSecurityRunner);
}
var sastStrategy = {
  id: "sast",
  async run(ctx) {
    const command = ctx.config.quality.securityCommand;
    if (command === void 0 || command.trim().length === 0) {
      return skip("sast", "no-security-command");
    }
    const validation = validateSecurityCommand(command);
    if (!validation.ok) {
      return ran("sast", false, `${validation.reason}: ${validation.detail}`);
    }
    const result = await ctx.tools.semgrep.run(validation.argv, { cwd: ctx.worktree });
    if (result.truncated) {
      throw new Error("sast gate: semgrep output truncated \u2014 refusing to parse a clipped payload");
    }
    const redact = ctx.config.quality.securityRedactFindings;
    const rawOutput = `${result.stdout}
${result.stderr}`.trim();
    const output = redact ? redactSecrets(rawOutput) : rawOutput;
    const exit = `exit=${result.code ?? "null"}`;
    const detail = output.length > 0 ? `${exit} :: ${output}` : exit;
    const clean = result.code === 0;
    if (clean) {
      return ran("sast", true, `security ${detail}`);
    }
    if (ctx.config.quality.securityAllowFailures) {
      return ran("sast", true, `security findings present but non-blocking (allowFailures) ${detail}`);
    }
    return ran("sast", false, `security findings present ${detail}`);
  }
};

// src/verifier/deterministic/strategies/type.ts
var typeStrategy = procStrategy(
  "type",
  "tsc --noEmit",
  (tools, opts) => tools.tsc.typecheck(opts)
);

// src/verifier/deterministic/strategies/lint.ts
var ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".eslintrc.json",
  ".eslintrc"
];
var ESLINT_BIN = "node_modules/.bin/eslint";
var lintStrategy = {
  id: "lint",
  async run(ctx) {
    const opts = { cwd: ctx.worktree };
    const command = contractCommand(ctx.contract, "lint");
    if (command !== void 0) {
      return procOutcome("lint", `contract:${command.join(" ")}`, await ctx.tools.command.run(command, opts));
    }
    const hasBin = await ctx.tools.fs.exists(ESLINT_BIN, opts);
    if (!hasBin) {
      return skip("lint", "no-eslint-binary");
    }
    const hasConfig = await ctx.tools.fs.existsAny(ESLINT_CONFIGS, opts);
    if (!hasConfig) {
      return skip("lint", "no-eslint-config");
    }
    return procOutcome("lint", "eslint", await ctx.tools.eslint.lint(opts));
  }
};

// src/verifier/deterministic/strategies/build.ts
var buildStrategy = procStrategy(
  "build",
  "build",
  (tools, opts) => tools.build.build(opts)
);

// src/verifier/deterministic/gate-runner.ts
var log19 = createLogger("gate-runner");
function strategyFor(id) {
  switch (id) {
    case "test":
      return testStrategy;
    case "tdd":
      return tddStrategy;
    case "coverage":
      return coverageStrategy;
    case "mutation":
      return mutationStrategy;
    case "sast":
      return sastStrategy;
    case "type":
      return typeStrategy;
    case "lint":
      return lintStrategy;
    case "build":
      return buildStrategy;
    default:
      return assertNever(id);
  }
}
var GateRunner = class {
  /**
   * Run the configured gates against `ctx.worktree`, collect evidence, and return
   * the report + DERIVED verdict. A strategy that throws (a structural/loud error
   * such as truncated tool output) propagates — the runner never swallows it into a
   * silent pass.
   */
  async run(ctx) {
    const gates = ctx.gates ?? GATE_IDS;
    const report = [];
    const evidence = [];
    const skipped = [];
    const load = await (ctx.loadContract ?? loadGateContract)(ctx.worktree);
    if (load.state === "invalid") {
      throw new Error(
        `gate contract: .factory/gates.json is INVALID (${load.error}) \u2014 fix or re-run \`factory scaffold\``
      );
    }
    if (load.state === "absent") {
      throw new Error(
        "gate contract: no .factory/gates.json in this worktree \u2014 the worktree was cut from a commit without the contract (older factory version, or the contract was never committed). Run `factory scaffold`, commit .factory/gates.json, and start a fresh run."
      );
    }
    const contract = load.contract;
    for (const id of gates) {
      const entry = contract.gates[id];
      if (!entry.contracted) {
        const reason = `uncontracted: ${entry.reason}`;
        report.push({ gate: id, outcome: { kind: "skip", gate: id, reason } });
        skipped.push({ gate: id, reason });
        log19.debug(`gate ${id} skipped: ${reason}`);
        continue;
      }
      const strategy = strategyFor(id);
      const sctx = {
        runId: ctx.runId,
        taskId: ctx.taskId,
        worktree: ctx.worktree,
        baseRef: ctx.baseRef,
        config: ctx.config,
        tools: ctx.tools,
        exemptReader: ctx.exemptReader,
        contract,
        coverageStore: ctx.coverageStore
      };
      let outcome = await strategy.run(sctx);
      if (outcome.kind === "skip" && classifySkip(outcome.reason) === "tooling") {
        outcome = ran(id, false, `contracted-but-unrunnable: ${outcome.reason}`);
        log19.warn(`gate ${id} contracted but unrunnable \u2014 failing loud`);
      }
      report.push({ gate: id, outcome });
      if (outcome.kind === "ran") {
        evidence.push(outcome.evidence);
      } else {
        skipped.push({ gate: outcome.gate, reason: outcome.reason });
        log19.debug(`gate ${id} skipped: ${outcome.reason}`);
      }
    }
    const verdict = deriveAllGatesVerdict(evidence);
    return { report, evidence, skipped, verdict };
  }
};

// src/verifier/deterministic/tdd-exempt.ts
import { readFile as readFile7 } from "node:fs/promises";
import path2 from "node:path";
var log20 = createLogger("verifier:tdd-exempt");
function isTddExempt(taskId, tasksJson, packageJson) {
  const list = extractTaskList(tasksJson);
  for (const entry of list) {
    if (typeof entry === "object" && entry !== null && entry.task_id === taskId && entry.tdd_exempt === true) {
      return true;
    }
  }
  if (typeof packageJson === "object" && packageJson !== null && typeof packageJson.factory === "object" && packageJson.factory?.tddExempt === true) {
    return true;
  }
  return false;
}
function extractTaskList(tasksJson) {
  if (Array.isArray(tasksJson)) {
    return tasksJson;
  }
  if (typeof tasksJson === "object" && tasksJson !== null && Array.isArray(tasksJson.tasks)) {
    return tasksJson.tasks;
  }
  return [];
}
var DefaultExemptReader = class {
  constructor(args) {
    this.args = args;
  }
  async isExempt(taskId) {
    const tasksJson = await readJsonOrNull(path2.join(this.args.specDir, "tasks.json"));
    const packageJson = await readJsonOrNull(path2.join(this.args.worktree, "package.json"));
    return isTddExempt(taskId, tasksJson, packageJson);
  }
};
async function readJsonOrNull(file) {
  let raw;
  try {
    raw = await readFile7(file, "utf8");
  } catch (err) {
    if (!isEnoent(err)) {
      log20.warn(`could not read '${file}': ${err.message} \u2014 treating as not exempt`);
    }
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    log20.warn(`could not parse '${file}': ${err.message} \u2014 treating as not exempt`);
    return null;
  }
}

// src/verifier/deterministic/tools.ts
import { access as access3, mkdtemp, readFile as readFile8, rm as rm3, symlink as symlink2 } from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import path3 from "node:path";
function toProc(r) {
  return { code: r.code, stdout: r.stdout, stderr: r.stderr, truncated: r.truncated };
}
function assertNotTruncated(r, what) {
  if (r.truncated) {
    throw new Error(
      `WS6 tool output for ${what} was TRUNCATED (hit maxBuffer) \u2014 refusing to parse a clipped payload`
    );
  }
}
async function resolveLocalBin(cwd, tool, exists = pathExists) {
  let dir = path3.resolve(cwd);
  for (; ; ) {
    const candidate = path3.join(dir, "node_modules", ".bin", tool);
    if (await exists(candidate)) {
      return candidate;
    }
    const parent = path3.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
var defaultLocalBinResolver = (tool, opts) => resolveLocalBin(opts.cwd, tool);
function missingBinResult(tool, cwd) {
  return {
    stdout: "",
    stderr: `${tool}: no local binary found under node_modules/.bin (walked up from ${cwd}); refusing the npx fallback \u2014 a bare \`npx ${tool}\` resolves a remote registry decoy under corepack/pnpm. Install dev dependencies so ${tool} resolves locally.`,
    code: 127,
    signal: null,
    truncated: false
  };
}
async function runTool(resolve3, tool, toolArgs, opts, env = {}) {
  const localBin = await resolve3(tool, opts);
  if (localBin === null) {
    return missingBinResult(tool, opts.cwd);
  }
  return exec(localBin, [...toolArgs], { cwd: opts.cwd, env });
}
var DefaultVitestTool = class {
  constructor(resolve3 = defaultLocalBinResolver, env = {}) {
    this.resolve = resolve3;
    this.env = env;
  }
  async run(files, opts) {
    const args = ["run", "--coverage.enabled=false", ...files];
    return toProc(await runTool(this.resolve, "vitest", args, opts, this.env));
  }
};
var DefaultTscTool = class {
  constructor(resolve3 = defaultLocalBinResolver, env = {}) {
    this.resolve = resolve3;
    this.env = env;
  }
  async typecheck(opts) {
    return toProc(await runTool(this.resolve, "tsc", ["--noEmit"], opts, this.env));
  }
};
var DefaultEslintTool = class {
  constructor(resolve3 = defaultLocalBinResolver, env = {}) {
    this.resolve = resolve3;
    this.env = env;
  }
  async lint(opts) {
    return toProc(await runTool(this.resolve, "eslint", ["."], opts, this.env));
  }
};
var DefaultBuildTool = class {
  constructor(env = {}) {
    this.env = env;
  }
  async build(opts) {
    return toProc(await exec("npm", ["run", "build"], { cwd: opts.cwd, env: this.env }));
  }
};
var DefaultArgvRunner = class {
  constructor(env = {}) {
    this.env = env;
  }
  async run(command, opts) {
    const [bin, ...rest] = command;
    if (bin === void 0) {
      throw new Error("DefaultArgvRunner: empty command");
    }
    return toProc(await exec(bin, rest, { cwd: opts.cwd, env: this.env }));
  }
};
var DefaultStrykerTool = class _DefaultStrykerTool {
  constructor(resolve3 = defaultLocalBinResolver, env = {}) {
    this.resolve = resolve3;
    this.env = env;
  }
  /** Report path relative to the worktree (stryker html/json reporter default). */
  static REPORT_PATH = "reports/mutation/mutation.json";
  async run(mutate, opts) {
    const csv = mutate.map(escapeStrykerGlob).join(",");
    const proc2 = toProc(await runTool(this.resolve, "stryker", ["run", "--mutate", csv], opts, this.env));
    const reportPath = path3.join(opts.cwd, _DefaultStrykerTool.REPORT_PATH);
    let raw;
    try {
      raw = await readFile8(reportPath, "utf8");
    } catch {
      return { proc: proc2, report: { report: "absent" } };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { proc: proc2, report: { report: "unparseable" } };
    }
    const score = extractMutationScore(parsed);
    return { proc: proc2, report: { report: "present", mutationScore: score } };
  }
};
function extractMutationScore(report) {
  if (typeof report !== "object" || report === null) {
    return null;
  }
  const metrics = report.metrics;
  if (typeof metrics === "object" && metrics !== null) {
    const score = metrics.mutationScore;
    if (typeof score === "number" && Number.isFinite(score)) {
      return score;
    }
  }
  return computeMutationScore(report);
}
var DETECTED_STATUSES = /* @__PURE__ */ new Set(["killed", "timeout"]);
var UNDETECTED_STATUSES = /* @__PURE__ */ new Set(["survived", "nocoverage"]);
function computeMutationScore(report) {
  const files = report.files;
  if (typeof files !== "object" || files === null) {
    return null;
  }
  let detected = 0;
  let valid = 0;
  for (const file of Object.values(files)) {
    const mutants = file.mutants;
    if (!Array.isArray(mutants)) {
      continue;
    }
    for (const mutant of mutants) {
      const rawStatus = mutant.status;
      if (typeof rawStatus !== "string") {
        continue;
      }
      const status = rawStatus.toLowerCase();
      if (DETECTED_STATUSES.has(status)) {
        detected += 1;
        valid += 1;
      } else if (UNDETECTED_STATUSES.has(status)) {
        valid += 1;
      }
    }
  }
  return valid > 0 ? detected / valid * 100 : null;
}
var DefaultCoverageTool = class _DefaultCoverageTool {
  constructor(resolve3 = defaultLocalBinResolver, env = {}) {
    this.resolve = resolve3;
    this.env = env;
  }
  /** Where every measurement must land, relative to the measured tree's root. */
  static SUMMARY_PATH = path3.join("coverage", "coverage-summary.json");
  async measure(cmd, opts) {
    const summaryPath = path3.join(opts.cwd, _DefaultCoverageTool.SUMMARY_PATH);
    await rm3(summaryPath, { force: true });
    let result;
    if (cmd.kind === "vitest") {
      result = await runTool(this.resolve, "vitest", cmd.args, opts, this.env);
    } else {
      const [bin, ...rest] = cmd.argv;
      if (bin === void 0) {
        throw new Error("DefaultCoverageTool: empty command");
      }
      result = await exec(bin, rest, { cwd: opts.cwd, env: this.env });
    }
    if (result.code !== 0) {
      return { kind: "command-failed", proc: toProc(result) };
    }
    let raw;
    try {
      raw = await readFile8(summaryPath, "utf8");
    } catch {
      return { kind: "summary-missing" };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: "summary-invalid" };
    }
    const summary = parseCoverageSummary(parsed);
    return summary === null ? { kind: "summary-invalid" } : { kind: "measured", summary };
  }
  async measureAtBase(baseSha, cmd, opts) {
    const scratch = await mkdtemp(path3.join(tmpdir2(), "factory-cov-base-"));
    const wt = path3.join(scratch, "wt");
    try {
      const add = await exec("git", ["-C", opts.cwd, "worktree", "add", "--detach", wt, baseSha], {
        cwd: opts.cwd
      });
      if (add.code !== 0) {
        throw new Error(
          `coverage base measurement: git worktree add --detach ${baseSha} failed (code=${add.code ?? "null"}): ${add.stderr.trim()}`
        );
      }
      if (await pathExists(path3.join(opts.cwd, "node_modules"))) {
        await symlink2(path3.join(opts.cwd, "node_modules"), path3.join(wt, "node_modules"), "dir");
      }
      return await this.measure(cmd, { cwd: wt });
    } finally {
      await exec("git", ["-C", opts.cwd, "worktree", "remove", "--force", wt], {
        cwd: opts.cwd
      }).catch(() => {
      });
      await rm3(scratch, { recursive: true, force: true }).catch(() => {
      });
      await exec("git", ["-C", opts.cwd, "worktree", "prune"], { cwd: opts.cwd }).catch(() => {
      });
    }
  }
};
var DefaultFsProbe = class {
  async exists(relPath, opts) {
    try {
      await access3(path3.join(opts.cwd, relPath));
      return true;
    } catch {
      return false;
    }
  }
  async existsAny(relPaths, opts) {
    for (const rel of relPaths) {
      if (await this.exists(rel, opts)) {
        return true;
      }
    }
    return false;
  }
};
function isPct(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}
function readMetric(total, key) {
  const v = total[key];
  if (isPct(v)) {
    return v;
  }
  if (typeof v === "object" && v !== null && isPct(v.pct)) {
    return v.pct;
  }
  return null;
}
function parseCoverageSummary(report) {
  if (typeof report !== "object" || report === null) {
    return null;
  }
  const total = report.total;
  if (typeof total !== "object" || total === null) {
    return null;
  }
  const t = total;
  const lines = readMetric(t, "lines");
  const branches = readMetric(t, "branches");
  const functions = readMetric(t, "functions");
  const statements = readMetric(t, "statements");
  if (lines === null || branches === null || functions === null || statements === null) {
    return null;
  }
  return { lines, branches, functions, statements };
}
var DefaultGitProbe = class {
  async git(args, cwd) {
    return exec("git", args, { cwd });
  }
  async refExists(ref, opts) {
    const r = await this.git(["rev-parse", "--verify", "--quiet", ref], opts.cwd);
    return r.code === 0;
  }
  async revParse(ref, opts) {
    const r = await this.git(["rev-parse", ref], opts.cwd);
    if (r.code !== 0) {
      throw new Error(`git rev-parse ${ref} failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
    }
    return r.stdout.trim();
  }
  async treeSha(opts) {
    return this.revParse("HEAD^{tree}", opts);
  }
  async changedFiles(base, opts) {
    const r = await this.git(["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`], opts.cwd);
    if (r.code !== 0) {
      throw new Error(`git diff vs ${base} failed (code=${r.code ?? "null"}): ${r.stderr.trim()}`);
    }
    assertNotTruncated(r, "git diff --name-only");
    return splitLines(r.stdout);
  }
  async commits(base, taskId, opts) {
    const log41 = await this.git(["log", "--format=%H", `${base}..HEAD`], opts.cwd);
    if (log41.code !== 0) {
      throw new Error(`git log ${base}..HEAD failed (code=${log41.code ?? "null"}): ${log41.stderr.trim()}`);
    }
    assertNotTruncated(log41, "git log (tdd classification)");
    const shas = splitLines(log41.stdout).reverse();
    const out = [];
    for (const sha of shas) {
      const parents = await this.git(["show", "-s", "--format=%P", sha], opts.cwd);
      if (parents.code !== 0) {
        throw new Error(`git show parents of ${sha} failed: ${parents.stderr.trim()}`);
      }
      assertNotTruncated(parents, `git show parents of ${sha}`);
      const parentShas = parents.stdout.trim().split(/\s+/).filter((s) => s.length > 0);
      const parentCount = parentShas.length;
      let files;
      if (parentCount > 1) {
        const firstParent = at(parentShas, 0);
        const dt = await this.git(
          ["diff-tree", "--no-commit-id", "--name-only", "-r", firstParent, sha],
          opts.cwd
        );
        if (dt.code !== 0) {
          throw new Error(`git diff-tree failed for ${sha}: ${dt.stderr.trim()}`);
        }
        assertNotTruncated(dt, `git diff-tree (merge) for ${sha}`);
        files = splitLines(dt.stdout);
      } else {
        const dt = await this.git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha], opts.cwd);
        if (dt.code !== 0) {
          throw new Error(`git diff-tree failed for ${sha}: ${dt.stderr.trim()}`);
        }
        assertNotTruncated(dt, `git diff-tree for ${sha}`);
        files = splitLines(dt.stdout);
      }
      const subjBody = await this.git(["log", "-1", "--format=%s%n%b", sha], opts.cwd);
      if (subjBody.code !== 0) {
        throw new Error(`git log subject/body of ${sha} failed: ${subjBody.stderr.trim()}`);
      }
      assertNotTruncated(subjBody, `git log subject/body of ${sha}`);
      const tagged = subjBody.stdout.includes(`[${taskId}]`);
      out.push({ sha, files, parentCount, tagged });
    }
    return out;
  }
};
function splitLines(s) {
  return s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}
function defaultGateTools(gateEnv = {}) {
  return {
    git: new DefaultGitProbe(),
    vitest: new DefaultVitestTool(defaultLocalBinResolver, gateEnv),
    tsc: new DefaultTscTool(defaultLocalBinResolver, gateEnv),
    eslint: new DefaultEslintTool(defaultLocalBinResolver, gateEnv),
    build: new DefaultBuildTool(gateEnv),
    semgrep: new DefaultArgvRunner(gateEnv),
    stryker: new DefaultStrykerTool(defaultLocalBinResolver, gateEnv),
    coverage: new DefaultCoverageTool(defaultLocalBinResolver, gateEnv),
    fs: new DefaultFsProbe(),
    command: new DefaultArgvRunner(gateEnv)
  };
}

// src/verifier/deterministic/coverage-store.ts
import { mkdir as mkdir7, readFile as readFile9, rename as rename3, writeFile } from "node:fs/promises";
import path4 from "node:path";
var TREE_SHA_RE = /^[0-9a-f]{40,64}$/;
function isSummary(v) {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const o = v;
  return ["lines", "branches", "functions", "statements"].every((k) => {
    const m = o[k];
    return typeof m === "number" && Number.isFinite(m) && m >= 0 && m <= 100;
  });
}
var FsCoverageStore = class {
  constructor(dir) {
    this.dir = dir;
  }
  /** Distinguishes same-process concurrent puts' tmp files (pid covers cross-process). */
  seq = 0;
  file(treeSha) {
    if (!TREE_SHA_RE.test(treeSha)) {
      throw new Error(`coverage store: invalid tree sha key '${treeSha}'`);
    }
    return path4.join(this.dir, `${treeSha}.json`);
  }
  async get(treeSha) {
    const file = this.file(treeSha);
    let raw;
    try {
      raw = await readFile9(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) {
        return null;
      }
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!isSummary(parsed)) {
      throw new Error(`coverage store: corrupt entry ${file} \u2014 delete it and re-run`);
    }
    return parsed;
  }
  async put(treeSha, summary) {
    const target = this.file(treeSha);
    await mkdir7(this.dir, { recursive: true });
    const tmp = path4.join(this.dir, `.tmp-${treeSha}-${process.pid}-${this.seq++}`);
    await writeFile(tmp, JSON.stringify(summary), "utf8");
    await rename3(tmp, target);
  }
};

// src/verifier/judgment/config.ts
var FALLBACK_REVIEW_MODEL = "opus";
function resolveReviewModel(config) {
  const m = config.review.model;
  if (m?.trim().length === 0) {
    throw new Error("review.model is configured but empty \u2014 set a non-empty fixed reviewer model or unset it");
  }
  return m ?? FALLBACK_REVIEW_MODEL;
}

// src/verifier/judgment/panel.ts
var REVIEWER_MODEL_BY_ROLE = {
  "implementation-reviewer": "sonnet",
  "quality-reviewer": "opus",
  "silent-failure-hunter": "sonnet",
  "systemic-failure-reviewer": "opus",
  "database-design-reviewer": "opus"
};
var FINDING_VERIFIER_MODEL = "sonnet";
function reviewerModelFor(role) {
  const model = REVIEWER_MODEL_BY_ROLE[role];
  if (model === void 0) {
    throw new Error(`panel: no reviewer model configured for role '${role}'`);
  }
  return model;
}
var VERIFIER_INTERPOLATE_FIELDS = ["claim", "file", "line", "quote"];
var VERIFIER_PROMPT_TEMPLATE = `You are an INDEPENDENT finding-verifier (verify-then-fix, D27). Try to REFUTE the
following review finding against the actual code \u2014 do not assume it is correct.

Claim: {claim}
Cited location: {file}:{line}
Quoted source: {quote}

Inspect the cited file/line yourself before deciding. Return EXACTLY one JSON
object as your final message: { "holds": true|false, "note": "<why>" }.`;
var PANEL_ROLES = [
  "implementation-reviewer",
  "quality-reviewer",
  "silent-failure-hunter",
  "systemic-failure-reviewer"
];
var DB_DESIGN_ROLE = "database-design-reviewer";
function panelRolesFor(dbApplicable) {
  return dbApplicable ? [...PANEL_ROLES, DB_DESIGN_ROLE] : PANEL_ROLES;
}
function buildPanelManifest(resumePhase, crossVendor, dbApplicable = false, crossVendorPrompt) {
  const agents = panelRolesFor(dbApplicable).map((role) => ({
    role,
    agent_type: AGENT_TYPE_BY_ROLE[role],
    isolation: "worktree",
    model: reviewerModelFor(role)
  }));
  const cross_vendor = crossVendor === void 0 ? void 0 : crossVendor.status === "present" ? { status: "present", model: crossVendor.slot.model, prompt: crossVendorPrompt } : { status: "absent", reason: crossVendor.reason };
  const verifier_spec = {
    agent_type: FINDING_VERIFIER_AGENT_TYPE,
    model: FINDING_VERIFIER_MODEL,
    isolation: "worktree",
    prompt_template: VERIFIER_PROMPT_TEMPLATE,
    interpolate_fields: [...VERIFIER_INTERPOLATE_FIELDS]
  };
  return parseSpawnRequest({
    resume_phase: resumePhase,
    agents,
    ...cross_vendor !== void 0 ? { cross_vendor } : {},
    verifier_spec
  });
}

// src/verifier/judgment/db-detect.ts
var DB_PATH_PATTERNS = [
  /(^|\/)migrations\//,
  // generic + supabase/migrations, django, alembic-as-migrations
  /(^|\/)db\/migrate\//,
  // rails
  /(^|\/)alembic\/versions\//,
  // alembic default layout
  /(^|\/)drizzle\//,
  // drizzle-kit output
  /(^|\/)schema\.prisma$/,
  // prisma
  /\.sql$/i
  // bare SQL anywhere
];
function isDbPath(path7) {
  return DB_PATH_PATTERNS.some((p) => p.test(path7));
}
async function touchesDatabase(git, baseRef, opts) {
  const changed = await git.changedFiles(baseRef, opts);
  return changed.some(isDbPath);
}

// src/verifier/judgment/cross-vendor-prompt.ts
import { readFile as readFile10 } from "node:fs/promises";
import path5 from "node:path";
async function composeCrossVendorPrompt(input) {
  const [charter, contract] = await Promise.all([
    readFile10(path5.join(input.pluginRoot, "agents", "quality-reviewer.md"), "utf8"),
    readFile10(path5.join(input.pluginRoot, "skills", "review-protocol", "SKILL.md"), "utf8")
  ]);
  return [
    charter.trim(),
    "",
    contract.trim(),
    "",
    `Task worktree: \`${input.worktree}\`. Base ref: \`${input.baseRef}\`. Inspect the change with \`git -C ${input.worktree} diff ${input.baseRef}..HEAD\`.`,
    ...input.priorDispositions !== void 0 ? ["", input.priorDispositions] : []
  ].join("\n");
}

// src/verifier/judgment/vendor.ts
async function resolveCrossVendor(codexModel, probe) {
  let available;
  try {
    available = await probe.available();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      status: "absent",
      reason: `cross-vendor probe '${probe.vendor}' failed: ${detail}`
    };
  }
  if (!available) {
    return {
      status: "absent",
      reason: `cross-vendor executor '${probe.vendor}' is not available`
    };
  }
  if (codexModel === void 0 || codexModel.trim().length === 0) {
    return {
      status: "absent",
      reason: `cross-vendor executor '${probe.vendor}' is available but no model is configured (codex.model)`
    };
  }
  return { status: "present", slot: { vendor: probe.vendor, model: codexModel } };
}

// src/verifier/judgment/codex-probe.ts
var CODEX_PROBE_TIMEOUT_MS = 5e3;
function makeCodexProbe(run9 = exec) {
  let memo;
  return {
    vendor: "codex",
    available() {
      memo ??= run9("codex", ["--version"], { timeoutMs: CODEX_PROBE_TIMEOUT_MS }).then((r) => r.code === 0);
      return memo;
    }
  };
}
var codexProbe = makeCodexProbe();
async function resolveCodexCrossVendor(codexModel, probe = codexProbe) {
  if (codexModel === void 0 || codexModel.trim().length === 0) {
    return {
      status: "absent",
      reason: "no cross-vendor model configured (codex.model)"
    };
  }
  return resolveCrossVendor(codexModel, probe);
}

// src/verifier/judgment/finding.ts
var log21 = createLogger("finding");
var FindingSeverityEnum = external_exports.enum(["info", "warning", "error", "critical"]);
var FindingBaseSchema = external_exports.object({
  /** Which panel reviewer raised this (free-form; the role string). */
  reviewer: external_exports.string().min(1),
  /** Closed severity. */
  severity: FindingSeverityEnum,
  /** True iff this finding, if upheld, BLOCKS the merge gate. */
  blocking: external_exports.boolean(),
  /** Cited file path (run-tree relative). Absent ⇒ uncitable. */
  file: external_exports.string().min(1).optional(),
  /** Cited 1-based line number. Absent ⇒ uncitable. Must be positive. */
  line: external_exports.number().int().positive().optional(),
  /**
   * The VERBATIM code the reviewer claims to be quoting. Required and non-empty —
   * a finding with no quote cannot be citation-verified, so we reject it loudly
   * rather than admit an unverifiable claim. (An empty string is rejected by
   * `.min(1)`.)
   */
  quote: external_exports.string().min(1),
  /**
   * The reviewer's ONE-SENTENCE checkable assertion (≤300 chars) — what the
   * independent finding-verifier confirms. Deliberately distinct from
   * `description`: the claim states WHAT is wrong in verifiable form; the
   * description carries the reasoning chain, which must never reach the
   * verifier (anti-anchoring — the verifier confirms independently, it is not
   * led). Required and bounded LOUDLY: an old-format finding without a claim
   * is a ZodError, never a silent fallback to truncated description.
   */
  claim: external_exports.string().min(1).max(300),
  /** Human-facing description of the concern (the reasoning; producer-facing). */
  description: external_exports.string().min(1)
});
var FindingSchema = FindingBaseSchema.superRefine((finding, ctx) => {
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
var RawReviewVerdictEnum = external_exports.enum(["approve", "blocked", "error"]);
var RawReviewSchema = external_exports.object({
  /** The reviewer identity (role string). */
  reviewer: external_exports.string().min(1),
  /** The reviewer's self-reported verdict. */
  verdict: RawReviewVerdictEnum,
  /** Findings raised. May be empty (an `approve` with no findings). */
  findings: external_exports.array(FindingSchema),
  /**
   * How many findings the reviewer dropped to stay under the findings cap
   * (self-reported per the review-protocol contract). {@link parseRawReview} adds
   * any engine-side truncation overflow on top, so silent cap truncation is
   * always visible rather than reading as full coverage.
   */
  dropped_by_cap: external_exports.number().int().min(0).optional()
});
var MAX_FINDINGS_PER_REVIEW = 10;
var KNOWN_REVIEW_KEYS = new Set(Object.keys(RawReviewSchema.shape));
var KNOWN_FINDING_KEYS = new Set(Object.keys(FindingBaseSchema.shape));
function warnStrippedKeys(context, topObj, topKnown, findingsArr, findingKnown) {
  const topUnknown = [];
  const findingUnknown = [];
  if (topObj !== null && typeof topObj === "object" && !Array.isArray(topObj)) {
    for (const k of Object.keys(topObj)) {
      if (!topKnown.has(k)) {
        topUnknown.push(k);
      }
    }
  }
  if (Array.isArray(findingsArr)) {
    for (const f of findingsArr) {
      if (f !== null && typeof f === "object" && !Array.isArray(f)) {
        for (const k of Object.keys(f)) {
          if (!findingKnown.has(k) && !findingUnknown.includes(k)) {
            findingUnknown.push(k);
          }
        }
      }
    }
  }
  if (topUnknown.length > 0 || findingUnknown.length > 0) {
    log21.warn(
      `review parse: stripped unknown keys from reviewer '${context}' payload: top[${topUnknown.join(", ")}] findings[${findingUnknown.join(", ")}]`
    );
  }
}
function parseRawReview(raw) {
  let result = RawReviewSchema.parse(raw);
  const rawReviewer = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw.reviewer : void 0;
  const reviewerLabel = typeof rawReviewer === "string" ? rawReviewer : result.reviewer;
  const rawFindings = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw.findings : void 0;
  warnStrippedKeys(reviewerLabel, raw, KNOWN_REVIEW_KEYS, rawFindings, KNOWN_FINDING_KEYS);
  if (result.findings.length > MAX_FINDINGS_PER_REVIEW) {
    const overflow = result.findings.length - MAX_FINDINGS_PER_REVIEW;
    log21.warn(
      `review parse: reviewer '${reviewerLabel}' exceeded the findings cap (${result.findings.length} > ${MAX_FINDINGS_PER_REVIEW}) \u2014 kept the first ${MAX_FINDINGS_PER_REVIEW}, ${overflow} truncated into dropped_by_cap`
    );
    result = {
      ...result,
      findings: result.findings.slice(0, MAX_FINDINGS_PER_REVIEW),
      dropped_by_cap: (result.dropped_by_cap ?? 0) + overflow
    };
  }
  if (result.dropped_by_cap !== void 0 && result.dropped_by_cap > 0) {
    log21.warn(
      `review parse: reviewer '${reviewerLabel}' dropped ${result.dropped_by_cap} finding(s) by cap \u2014 coverage is truncated, not exhaustive`
    );
  }
  return result;
}
function isCitable(f) {
  return f.file !== void 0 && f.line !== void 0;
}

// src/verifier/judgment/citation-verify.ts
var CITATION_WINDOW = 2;
function redactFinding(f) {
  return { ...f, quote: redactSecrets(f.quote), description: redactSecrets(f.description) };
}
function checkQuote(quote, line, lines) {
  const lo = Math.max(1, line - CITATION_WINDOW);
  const hi = Math.min(lines.length, line + CITATION_WINDOW);
  if (lo > hi) {
    return "line-out-of-range";
  }
  for (let n = lo; n <= hi; n++) {
    const text = lines[n - 1];
    if (text?.includes(quote) === true) {
      return null;
    }
  }
  return "quote-not-in-window";
}
function rescueLine(quote, reason, lines) {
  if (reason !== "quote-not-in-window" && reason !== "line-out-of-range") {
    return null;
  }
  const needle = quote.trim();
  if (needle === "" || needle.includes("\n")) {
    return null;
  }
  const matches = [];
  for (let n = 1; n <= lines.length; n++) {
    const text = lines[n - 1];
    if (text?.includes(needle) === true) {
      matches.push(n);
    }
  }
  return matches.length === 1 ? at(matches, 0) : null;
}
function verifyCitations(findings, source, options = {}) {
  const redact = options.redact ?? true;
  const kept = [];
  const dropped = [];
  const audit = [];
  for (const f of findings) {
    if (!isCitable(f)) {
      dropped.push({ finding: f, reason: "uncitable" });
      audit.push(`DROP uncitable: ${f.reviewer} \u2014 ${f.description}`);
      continue;
    }
    const lines = source.readLines(f.file);
    if (lines === null) {
      dropped.push({ finding: f, reason: "file-not-found" });
      audit.push(`DROP file-not-found ${f.file}:${f.line}: ${f.reviewer}`);
      continue;
    }
    const reason = checkQuote(f.quote, f.line, lines);
    if (reason !== null) {
      const found = rescueLine(f.quote, reason, lines);
      if (found === null) {
        dropped.push({ finding: f, reason });
        audit.push(`DROP ${reason} ${f.file}:${f.line}: ${f.reviewer}`);
        continue;
      }
      const relocated = { ...f, line: found };
      kept.push({
        finding: redact ? redactFinding(relocated) : relocated,
        citedLine: f.line
      });
      audit.push(`RELOCATE relocated_ok ${f.file}:${f.line}\u2192${found}: ${f.reviewer}`);
      continue;
    }
    const retained = redact ? redactFinding(f) : f;
    kept.push({ finding: retained });
    audit.push(`KEEP ${f.file}:${f.line}: ${f.reviewer}`);
  }
  return { kept, dropped, audit };
}

// src/verifier/judgment/finding-verifier.ts
async function confirmBlocker(finding, runner, finderIdentity, citedLine) {
  if (runner.identity === finderIdentity) {
    throw new Error(
      `finding-verifier identity '${runner.identity}' equals the finder's \u2014 the verifier must be INDEPENDENT (D27)`
    );
  }
  const projection = {
    claim: finding.claim,
    file: finding.file,
    line: citedLine ?? finding.line,
    quote: finding.quote
  };
  let verdict;
  try {
    verdict = await runner.confirm(projection);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: "error", reason: `finding-verifier errored: ${detail}` };
  }
  return verdict.holds ? { status: "confirmed", evidence: { note: verdict.note } } : { status: "refuted", reason: verdict.note };
}

// src/verifier/judgment/panel-run.ts
async function adjudicateReviewer(review, source, makeRunner2, redact) {
  const blocking = review.findings.filter((f) => f.blocking);
  const { kept } = verifyCitations(blocking, source, { redact });
  const runner = makeRunner2(review);
  const confirmed = [];
  const refuted = [];
  let hadVerifierError = false;
  for (const { finding, citedLine } of kept) {
    if (!isCitable(finding)) {
      continue;
    }
    const outcome = await confirmBlocker(finding, runner, review.reviewer, citedLine);
    if (outcome.status === "confirmed") {
      confirmed.push(finding);
    } else if (outcome.status === "error") {
      hadVerifierError = true;
    } else {
      refuted.push({ finding, reason: outcome.reason });
    }
  }
  return {
    reviewer: review.reviewer,
    rawVerdict: review.verdict,
    confirmedBlockers: confirmed,
    refuted,
    hadVerifierError,
    raisedBlockers: blocking.length,
    citedBlockers: kept.length
  };
}
function reviewerResultOf(a) {
  const verdict = a.hadVerifierError || a.rawVerdict === "error" ? "error" : a.confirmedBlockers.length > 0 ? "blocked" : "approve";
  return { reviewer: a.reviewer, verdict, confirmed_blockers: a.confirmedBlockers.length };
}
async function runPanel(input) {
  const redact = input.redact ?? true;
  const adjudicated = [];
  for (const review of input.reviews) {
    adjudicated.push(await adjudicateReviewer(review, input.source, input.makeRunner, redact));
  }
  let reviewerResults = adjudicated.map(reviewerResultOf);
  const demoted = input.blockOnCrossVendorAbsence === true && input.crossVendor?.status === "absent";
  if (demoted) {
    const hasQuality = reviewerResults.some((r) => r.reviewer === "quality-reviewer");
    reviewerResults = hasQuality ? reviewerResults.map((r) => r.reviewer === "quality-reviewer" ? { ...r, verdict: "error" } : r) : [...reviewerResults, { reviewer: "quality-reviewer", verdict: "error", confirmed_blockers: 0 }];
  }
  const mergeGate = deriveMergeGateVerdict({ reviewers: [...reviewerResults] }, input.gateEvidence);
  const result = mergeGate.passed ? advance(nextOrSelf(input.phase)) : waitRetry(
    input.phase,
    demoted ? `cross-vendor reviewer required (review.requireCrossVendor=block) but absent: ${input.crossVendor.reason}` : mergeGateBlockReason(reviewerResults, input.gateEvidence),
    input.attempt ?? 1,
    input.maxAttempts ?? 1
  );
  const crossVendorAbsence = input.crossVendor?.status === "absent" ? { reason: input.crossVendor.reason } : void 0;
  return crossVendorAbsence === void 0 ? { adjudicated, reviewerResults, mergeGate, result } : { adjudicated, reviewerResults, mergeGate, result, crossVendorAbsence };
}
function nextOrSelf(phase) {
  return phase === "verify" ? "ship" : phase;
}

// src/verifier/judgment/dispositions.ts
var DISPOSITION_CAP = 30;
var collapseWs = (s) => s.replace(/\s+/g, " ").trim();
function fingerprintOf(d) {
  return `${d.file ?? ""}|${collapseWs(d.quote)}|${collapseWs(d.claim).toLowerCase()}`;
}
function toDisposition(f, disposition, round, note) {
  return {
    reviewer: f.reviewer,
    disposition,
    ...f.file !== void 0 ? { file: f.file } : {},
    ...f.line !== void 0 ? { line: f.line } : {},
    quote: f.quote,
    claim: f.claim,
    ...note !== void 0 ? { note } : {},
    round
  };
}
function composeDispositions(reviews, adjudicated, round) {
  const refuted = adjudicated.flatMap(
    (a) => a.refuted.map(({ finding, reason }) => toDisposition(finding, "refuted", round, reason))
  );
  const nonBlocking = reviews.flatMap(
    (r) => r.findings.filter((f) => !f.blocking).map((f) => toDisposition(f, "non-blocking", round))
  );
  return [...refuted, ...nonBlocking];
}
function appendDispositions(prior, next, cap = DISPOSITION_CAP) {
  const byFingerprint = /* @__PURE__ */ new Map();
  for (const d of [...prior ?? [], ...next]) {
    byFingerprint.set(fingerprintOf(d), d);
  }
  return [...byFingerprint.values()].sort((a, b) => a.round - b.round).slice(-cap);
}
function renderDispositionLedger(entries) {
  if (entries === void 0 || entries.length === 0) {
    return void 0;
  }
  const lines = entries.map((d) => {
    const where = d.file !== void 0 ? ` ${d.file}${d.line !== void 0 ? `:${d.line}` : ""}` : "";
    const note = d.note !== void 0 ? ` \u2014 ${collapseWs(d.note)}` : "";
    return `- [${d.disposition}, round ${d.round}, ${d.reviewer}]${where} \u2014 "${collapseWs(d.claim)}"${note}`;
  });
  return [
    "## Previously adjudicated findings (input document \u2014 NOT shared belief-state)",
    "",
    "The claims below were dismissed in a prior review round: `refuted` means an",
    "independent verifier checked the claim against the code and it did not hold;",
    "`non-blocking` means it was raised advisory-only. Do NOT re-raise one as a new",
    "blocking finding on the same evidence. ONLY if you have NEW evidence that a",
    "disposition is wrong, raise the finding with its description prefixed",
    '"CHALLENGES PRIOR DISPOSITION:" and cite the new evidence. This list says',
    "nothing about the rest of the diff \u2014 review everything else with fresh eyes.",
    "",
    ...lines
  ].join("\n");
}

// src/verifier/holdout/validate.ts
function clampThreshold(raw) {
  if (!Number.isFinite(raw)) {
    return 80;
  }
  const t = Math.floor(raw);
  return t < 1 ? 1 : t;
}
function buildHoldoutPrompt(record, worktree, baseRef) {
  const lines = [];
  if (worktree !== void 0 && worktree.length > 0) {
    if (baseRef === void 0 || baseRef.length === 0) {
      throw new Error(
        "buildHoldoutPrompt: baseRef is required when a worktree is provided (the per-run staging base ref the worktree forked from)"
      );
    }
    lines.push(
      `The implementation lives in the task worktree at: ${worktree}`,
      `Inspect it with: git -C ${worktree} diff ${baseRef}`,
      `Do NOT rely on your own working directory \u2014 it is a fresh checkout with no diff.`,
      ""
    );
  }
  lines.push(
    `Holdout validation for task ${record.task_id}.`,
    "",
    "The implementer was NOT shown the following acceptance criteria during execution.",
    "Independently verify whether the current diff satisfies each one.",
    "",
    `Withheld criteria (${record.withheld_count} of ${record.total_criteria} total):`,
    ...record.withheld_criteria.map((c, i) => `  ${i + 1}. ${c}`),
    "",
    "Respond with a single JSON object, no prose, exactly this shape:",
    '{ "criteria": [ { "criterion": "<exact text from above>", "satisfied": true|false, "evidence": "<file:line or short rationale>" }, ... ] }',
    "",
    "One entry per withheld criterion, in the same order. A missing entry is treated as a failure."
  );
  return lines.join("\n");
}
function extractCriteria(raw) {
  const candidates = [raw];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced?.[1] != null && fenced[1].length > 0) {
    candidates.push(fenced[1]);
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed != null && typeof parsed === "object" && Array.isArray(parsed.criteria)) {
        return parsed.criteria;
      }
    } catch {
    }
  }
  throw new Error("holdout validator output has no parseable JSON object with .criteria");
}
function parseHoldoutVerdicts(raw) {
  return extractCriteria(raw).map((entry, i) => {
    const e = entry ?? {};
    if (typeof e.criterion !== "string" || typeof e.satisfied !== "boolean" || typeof e.evidence !== "string") {
      throw new Error(
        `holdout verdict entry ${i + 1} is malformed \u2014 criterion/satisfied/evidence must be string/boolean/string`
      );
    }
    return { criterion: e.criterion, satisfied: e.satisfied, evidence: e.evidence };
  });
}
function classifyHoldoutOutput(record, raw) {
  let verdicts;
  try {
    verdicts = parseHoldoutVerdicts(raw);
  } catch (err) {
    return { kind: "evaluator-failure", reason: err instanceof Error ? err.message : String(err) };
  }
  const withheld = record.withheld_criteria;
  if (verdicts.length !== withheld.length) {
    return {
      kind: "evaluator-failure",
      reason: `wrong verdict cardinality (${verdicts.length} verdicts for ${withheld.length} withheld criteria)`
    };
  }
  for (let i = 0; i < withheld.length; i++) {
    const v = verdicts[i];
    if (v === void 0 || v.criterion !== withheld[i]) {
      return { kind: "evaluator-failure", reason: `criterion text mismatch at position ${i + 1}` };
    }
    if (v.satisfied && v.evidence.trim().length === 0) {
      return {
        kind: "evaluator-failure",
        reason: `satisfied verdict with blank evidence at position ${i + 1}`
      };
    }
  }
  return { kind: "verdicts", verdicts };
}
function checkHoldout(record, verdicts, rawThreshold) {
  const threshold = clampThreshold(rawThreshold);
  const criteria = record.withheld_criteria.map((criterion, i) => {
    const r = verdicts[i];
    const satisfied2 = r?.criterion === criterion && r.satisfied && r.evidence.trim().length > 0;
    return { criterion, satisfied: satisfied2, evidence: r?.evidence ?? null };
  });
  const satisfied = criteria.filter((c) => c.satisfied).length;
  const withheld = record.withheld_count;
  const passPct = withheld > 0 ? Math.floor(satisfied * 100 / withheld) : 100;
  return {
    status: passPct >= threshold ? "pass" : "fail",
    satisfied,
    withheld,
    passPct,
    threshold,
    criteria
  };
}
function holdoutEvidence(result) {
  return {
    gate: "holdout",
    observed: result.status === "pass",
    detail: `holdout ${result.satisfied}/${result.withheld} (${result.passPct}% ${result.status === "pass" ? "\u2265" : "<"} ${result.threshold}%)`
  };
}

// src/verifier/holdout/split.ts
import { createHash } from "node:crypto";
function holdoutCount(total, percent) {
  if (percent <= 0 || total <= 1) {
    return 0;
  }
  let count = Math.floor(total * percent / 100);
  if (count < 1) {
    count = 1;
  }
  if (count >= total) {
    count = total - 1;
  }
  return count;
}
function rankKey(seed, index) {
  return createHash("sha256").update(`${seed}\0${index}`).digest("hex");
}
function splitHoldout(criteria, percent, seed) {
  const total = criteria.length;
  const count = holdoutCount(total, percent);
  if (count === 0) {
    return { visible: [...criteria], withheld: [] };
  }
  const withheldIdx = new Set(
    criteria.map((_, i) => ({ i, key: rankKey(seed, i) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i).slice(0, count).map((r) => r.i)
  );
  const visible = [];
  const withheld = [];
  criteria.forEach((c, i) => {
    ;
    (withheldIdx.has(i) ? withheld : visible).push(c);
  });
  return { visible, withheld };
}

// src/verifier/holdout/store.ts
import { mkdir as mkdir8, readFile as readFile11 } from "node:fs/promises";
import { dirname as dirname7, join as join11 } from "node:path";
var HoldoutRecordSchema = external_exports.object({
  task_id: external_exports.string().min(1),
  withheld_criteria: external_exports.array(external_exports.string()),
  total_criteria: external_exports.number().int().nonnegative(),
  withheld_count: external_exports.number().int().nonnegative()
}).strict().refine((r) => r.withheld_count === r.withheld_criteria.length, {
  message: "withheld_count must equal withheld_criteria.length"
}).refine((r) => r.withheld_count <= r.total_criteria, {
  message: "withheld_count must not exceed total_criteria (cannot withhold more than were split)"
});
function parseHoldoutRecord(raw, source) {
  const result = HoldoutRecordSchema.safeParse(raw);
  if (!result.success) {
    const where = source != null && source.length > 0 ? ` (${source})` : "";
    throw new Error(`invalid holdout record${where}: ${result.error.message}`);
  }
  return result.data;
}
function makeHoldoutRecord(taskId, withheld, totalCriteria) {
  return {
    task_id: taskId,
    withheld_criteria: [...withheld],
    total_criteria: totalCriteria,
    withheld_count: withheld.length
  };
}
var FsHoldoutStore = class {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }
  path(runId, taskId) {
    const safe = validateId(taskId, "task_id");
    return join11(runDir(this.dataDir, runId), "holdouts", `${safe}.json`);
  }
  async put(runId, record) {
    const path7 = this.path(runId, record.task_id);
    await mkdir8(dirname7(path7), { recursive: true });
    await atomicWriteFile(path7, stringifyJson(record));
  }
  async get(runId, taskId) {
    const path7 = this.path(runId, taskId);
    const raw = await readFile11(path7, "utf8");
    return parseHoldoutRecord(parseJson(raw, path7), path7);
  }
  async has(runId, taskId) {
    try {
      await readFile11(this.path(runId, taskId), "utf8");
      return true;
    } catch (err) {
      if (isEnoent(err)) {
        return false;
      }
      throw err;
    }
  }
};

// src/verifier/holdout/verdict-store.ts
import { mkdir as mkdir9, readFile as readFile12 } from "node:fs/promises";
import { dirname as dirname8, join as join12 } from "node:path";
var HoldoutVerdictSchema = external_exports.object({
  criterion: external_exports.string(),
  satisfied: external_exports.boolean(),
  evidence: external_exports.string()
}).strict();
var HoldoutVerdictsSchema = external_exports.array(HoldoutVerdictSchema);
var FsHoldoutVerdictStore = class {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }
  path(runId, taskId, rung) {
    const safe = validateId(taskId, "task_id");
    return join12(runDir(this.dataDir, runId), "holdouts", `${safe}.r${rung}.verdicts.json`);
  }
  async put(runId, taskId, rung, verdicts) {
    const path7 = this.path(runId, taskId, rung);
    await mkdir9(dirname8(path7), { recursive: true });
    await atomicWriteFile(path7, stringifyJson([...verdicts]));
  }
  async get(runId, taskId, rung) {
    const path7 = this.path(runId, taskId, rung);
    const raw = await readFile12(path7, "utf8");
    return HoldoutVerdictsSchema.parse(parseJson(raw, path7));
  }
  async has(runId, taskId, rung) {
    try {
      await readFile12(this.path(runId, taskId, rung), "utf8");
      return true;
    } catch (err) {
      if (isEnoent(err)) {
        return false;
      }
      throw err;
    }
  }
};

// src/verifier/holdout/index.ts
async function deriveHoldoutEvidence(holdout, verdictStore, runId, taskId, rung, passRate) {
  if (!await holdout.has(runId, taskId)) {
    return void 0;
  }
  const record = await holdout.get(runId, taskId);
  const verdicts = await verdictStore.get(runId, taskId, rung);
  return holdoutEvidence(checkHoldout(record, verdicts, passRate));
}

// src/verifier/e2e/runner.ts
import path6 from "node:path";
var E2E_ERROR_DETAIL_MAX_BYTES = 4096;
async function resolveLocalPlaywrightBin(cwd, exists = pathExists) {
  let dir = path6.resolve(cwd);
  for (; ; ) {
    const candidate = path6.join(dir, "node_modules", ".bin", "playwright");
    if (await exists(candidate)) {
      return candidate;
    }
    const parent = path6.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
function missingBinResult2(cwd) {
  return {
    code: 127,
    stdout: "",
    stderr: `playwright: no local binary found under node_modules/.bin (walked up from ${cwd}); refusing the npx fallback \u2014 install @playwright/test so the pinned local binary resolves.`,
    truncated: false
  };
}
var DefaultPlaywrightTool = class {
  constructor(resolve3 = resolveLocalPlaywrightBin) {
    this.resolve = resolve3;
  }
  async run(opts) {
    const bin = await this.resolve(opts.cwd);
    if (bin === null) {
      return missingBinResult2(opts.cwd);
    }
    const args = ["test"];
    if (opts.config != null && opts.config.length > 0) {
      args.push("--config", opts.config);
    } else if (opts.testDir != null && opts.testDir.length > 0) {
      args.push(opts.testDir);
    }
    if (opts.grep != null && opts.grep.length > 0) {
      args.push("--grep", opts.grep);
    }
    args.push("--reporter=json");
    const result = await exec(bin, args, {
      cwd: opts.cwd,
      env: opts.env,
      envMode: opts.replaceEnv === true ? "replace" : void 0
    });
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated
    };
  }
};
function collectSpecs(suites) {
  const out = [];
  for (const suite of suites ?? []) {
    out.push(...suite.specs ?? []);
    out.push(...collectSpecs(suite.suites));
  }
  return out;
}
function specStatus(spec) {
  const statuses = spec.tests.map((t) => t.status);
  if (statuses.includes("unexpected")) {
    return "failed";
  }
  if (statuses.includes("flaky")) {
    return "flaky";
  }
  if (statuses.length > 0 && statuses.every((s) => s === "skipped")) {
    return "skipped";
  }
  return "passed";
}
var ANSI_RE = /\x1b\[[0-9;]*m/g;
function truncateBytes(s, max) {
  if (Buffer.byteLength(s, "utf8") <= max) {
    return s;
  }
  const clipped = Buffer.from(s, "utf8").subarray(0, max).toString("utf8");
  return clipped.replace(/�+$/, "") + "\n\u2026 [error detail truncated]";
}
function specError(spec) {
  const messages = spec.tests.flatMap((t) => t.results ?? []).flatMap((r) => r.errors != null && r.errors.length > 0 ? r.errors : r.error ? [r.error] : []).map((e) => e.message).filter((m) => typeof m === "string" && m.trim().length > 0).map((m) => m.replace(ANSI_RE, "").trim());
  if (messages.length === 0) {
    return void 0;
  }
  return truncateBytes([...new Set(messages)].join("\n---\n"), E2E_ERROR_DETAIL_MAX_BYTES);
}
function parseE2eReport(json, code = 0) {
  let report;
  try {
    report = JSON.parse(json);
  } catch (err) {
    throw new Error(`e2e runner: could not parse Playwright JSON reporter output: ${err.message}`);
  }
  const specs = collectSpecs(report.suites).map((s) => {
    const status = specStatus(s);
    const error = status === "failed" ? specError(s) : void 0;
    return { file: s.file, title: s.title, status, ...error !== void 0 && { error } };
  });
  const counts = {
    passed: specs.filter((s) => s.status === "passed").length,
    failed: specs.filter((s) => s.status === "failed").length,
    flaky: specs.filter((s) => s.status === "flaky").length,
    skipped: specs.filter((s) => s.status === "skipped").length
  };
  const ok = counts.failed === 0 && (report.errors ?? []).length === 0 && code === 0;
  return { ok, specs, counts };
}
async function runE2e(opts, tool = new DefaultPlaywrightTool()) {
  const result = await tool.run(opts);
  if (result.truncated) {
    throw new Error(
      `e2e runner: Playwright JSON reporter output for ${opts.cwd} was TRUNCATED (hit maxBuffer) \u2014 refusing to parse a clipped payload`
    );
  }
  if (result.stdout.trim().length === 0) {
    throw new Error(`e2e runner: playwright produced no output (code=${result.code ?? "null"}): ${result.stderr}`);
  }
  return parseE2eReport(result.stdout, result.code);
}

// src/orchestrator/readiness.ts
function depsSatisfied(run9, depends) {
  return depends.every((d) => run9.tasks[d]?.status === "done");
}
function isUnsatisfiableDep(run9, depId) {
  const dep = run9.tasks[depId];
  return dep === void 0 || dep.status === "failed";
}

// src/rescue/scan.ts
function dispositionOf(status, failureClass) {
  if (status === "done") {
    return "shipped";
  }
  if (status === "pending") {
    return "runnable";
  }
  if (status === "failed") {
    return failureClass === "blocked-environmental" || failureClass === "needs-context" || failureClass === "blocked-dependency" ? "recoverable" : "dead-end";
  }
  return "stuck";
}
function scanRun(run9) {
  const all = Object.values(run9.tasks);
  const tasks = all.map((t) => ({
    task_id: t.task_id,
    status: t.status,
    disposition: dispositionOf(t.status, t.failure_class),
    ...t.failure_class !== void 0 ? { failure_class: t.failure_class } : {},
    ...t.failure_reason !== void 0 ? { failure_reason: t.failure_reason } : {},
    ...t.branch !== void 0 ? { branch: t.branch } : {},
    ...t.pr_number !== void 0 ? { pr_number: t.pr_number } : {},
    ...t.needs_context !== void 0 ? { question: t.needs_context.question } : {}
  }));
  const by = (d) => tasks.filter((t) => t.disposition === d);
  const stuck = by("stuck");
  const recoverable = by("recoverable");
  const deadEnd = by("dead-end");
  const resettable = [...stuck, ...recoverable].map((t) => t.task_id);
  const dead_ends = deadEnd.map((t) => t.task_id);
  const allTerminal = all.every((t) => isTerminalTaskStatus(t.status));
  const actionablePending = all.some(
    (t) => t.status === "pending" && (depsSatisfied(run9, t.depends_on) || t.depends_on.some((d) => isUnsatisfiableDep(run9, d)))
  );
  const would_deadlock = !allTerminal && !actionablePending;
  const e2e_failed = run9.e2e_phase?.status === "failed";
  const e2e_assessment_failed = run9.e2e_assessment?.status === "failed";
  const traceability_failed = run9.traceability?.status === "failed";
  const rollup_pending = run9.rollup?.merged === false;
  const empty_task_map = all.length === 0;
  const needs_rescue = resettable.length > 0 || e2e_failed || e2e_assessment_failed || traceability_failed || rollup_pending || empty_task_map;
  return {
    run_id: run9.run_id,
    run_status: run9.status,
    ...run9.terminal_reason !== void 0 ? { terminal_reason: run9.terminal_reason } : {},
    counts: {
      total: all.length,
      shipped: by("shipped").length,
      runnable: by("runnable").length,
      stuck: stuck.length,
      recoverable: recoverable.length,
      dead_end: deadEnd.length
    },
    resettable,
    dead_ends,
    needs_rescue,
    e2e_failed,
    e2e_assessment_failed,
    traceability_failed,
    rollup_pending,
    would_deadlock,
    empty_task_map,
    summary: summarize(
      run9.status,
      resettable.length,
      dead_ends.length,
      would_deadlock,
      e2e_failed,
      e2e_assessment_failed,
      traceability_failed,
      rollup_pending,
      empty_task_map
    ),
    tasks
  };
}
function summarize(status, resettable, deadEnds, wouldDeadlock, e2eFailed, e2eAssessmentFailed, traceabilityFailed, rollupPending, emptyTaskMap) {
  if (emptyTaskMap) {
    return `run '${status}': zero tasks \u2014 half-created; cancel it (\`factory run cancel --cleanup\`) and re-create`;
  }
  const e2eTail = e2eFailed ? " (e2e phase failed \u2014 needs a fix + --reset-e2e)" : "";
  const assessTail = e2eAssessmentFailed ? " (e2e assessment failed \u2014 needs a fix + --reset-e2e)" : "";
  const traceTail = traceabilityFailed ? " (PRD-traceability failed \u2014 needs a fix + --reset-traceability)" : "";
  const rollupTail = rollupPending ? status === "completed" ? " (rollup armed, not landed \u2014 re-run finalize once merged via --recheck-rollup)" : " (forward-reconcile conflict \u2014 resolve it on the staging branch, then `factory resume`)" : "";
  if (resettable === 0) {
    const deadEndTail = deadEnds > 0 ? ` (${deadEnds} dead-end failure(s) \u2014 need a fix + --include-dead-ends)` : "";
    if (e2eFailed || e2eAssessmentFailed || traceabilityFailed || rollupPending) {
      return `run '${status}': no task rescue needed${deadEndTail}${e2eTail}${assessTail}${traceTail}${rollupTail}`;
    }
    return `run '${status}': no rescue needed${deadEndTail}`;
  }
  const reopen = isTerminalRunStatus(status) ? " (will reopen the run)" : "";
  const deadlock = wouldDeadlock ? "; a re-drive would deadlock without rescue" : "";
  return `run '${status}': rescue can reset ${resettable} task(s)${reopen}${deadlock}${e2eTail}${assessTail}${traceTail}${rollupTail}`;
}

// src/rescue/assess.ts
async function assessWork(run9, probe) {
  const baseRef = `origin/${run9.staging_branch}`;
  const baseResolved = await probe.refExists(baseRef);
  const tasks = [];
  for (const t of Object.values(run9.tasks)) {
    if (t.status === "done") {
      continue;
    }
    if (t.branch === void 0) {
      continue;
    }
    const branchExists = await probe.refExists(t.branch);
    const pr = t.pr_number !== void 0 ? { pr_number: t.pr_number } : {};
    if (branchExists) {
      const commitsAhead = baseResolved ? await probe.commitsAhead(baseRef, t.branch) : null;
      tasks.push({
        task_id: t.task_id,
        branch: t.branch,
        branch_exists: true,
        commits_ahead: commitsAhead,
        ...pr
      });
    } else {
      tasks.push({
        task_id: t.task_id,
        branch: t.branch,
        branch_exists: false,
        commits_ahead: null,
        ...pr
      });
    }
  }
  return { base_ref: baseRef, base_resolved: baseResolved, tasks };
}

// src/rescue/reconcile.ts
function toPrFact(pr) {
  const oid = pr.mergeCommit?.oid;
  return {
    number: pr.number,
    state: pr.state,
    baseRefName: pr.baseRefName,
    ...oid !== void 0 ? { merge_sha: oid } : {},
    ...pr.url !== void 0 ? { url: pr.url } : {}
  };
}
async function gatherRunFacts(run9, gh) {
  const slug = run9.spec.repo;
  const { owner, repo } = splitRepoSlug(slug);
  const stagingTip = await gh.branchTip(owner, repo, run9.staging_branch);
  const tasks = [];
  for (const t of Object.values(run9.tasks)) {
    if (t.branch === void 0) {
      continue;
    }
    const prs = (await gh.prList({ head: t.branch, state: "all", repo: slug })).map(toPrFact);
    const hit = t.pr_number !== void 0 ? prs.find((p) => p.number === t.pr_number) : void 0;
    const branchTip = hit?.state === "OPEN" ? await gh.branchTip(owner, repo, t.branch) : void 0;
    tasks.push({
      task_id: t.task_id,
      branch: t.branch,
      recorded_status: t.status,
      ...t.pr_number !== void 0 ? { recorded_pr_number: t.pr_number } : {},
      prs,
      ...branchTip !== void 0 ? { branch_tip: branchTip } : {}
    });
  }
  const rollup2 = run9.rollup?.merged === false ? {
    ...run9.rollup.number !== void 0 ? { recorded_number: run9.rollup.number } : {},
    prs: (await gh.prList({ head: run9.staging_branch, state: "all", repo: slug })).map(toPrFact)
  } : void 0;
  return {
    repo: slug,
    staging: { branch: run9.staging_branch, tip: stagingTip },
    tasks,
    ...rollup2 !== void 0 ? { rollup: rollup2 } : {}
  };
}
var CLOSED_DRIFT_STATUSES = ["pending", "executing", "reviewing", "shipping"];
function classifyTask(t, f) {
  if (t.status === "done") {
    return [];
  }
  const base = { task_id: f.task_id, branch: f.branch };
  const drifts = [];
  if (f.recorded_pr_number !== void 0) {
    const hit = f.prs.find((p) => p.number === f.recorded_pr_number);
    if (hit === void 0) {
      drifts.push({
        class: "stale-pr-number",
        ...base,
        recorded_pr_number: f.recorded_pr_number,
        detail: `recorded pr_number #${f.recorded_pr_number} matches no PR on head '${f.branch}' (head has: ${f.prs.length > 0 ? f.prs.map((p) => `#${p.number} ${p.state}`).join(", ") : "none"}); the next ship's idempotent create will rebind \u2014 or clear the pointer manually`
      });
    } else if (hit.state === "MERGED") {
      drifts.push({
        class: "merged-unrecorded",
        ...base,
        recorded_pr_number: f.recorded_pr_number,
        pr_number: hit.number,
        pr_state: hit.state,
        ...hit.merge_sha !== void 0 ? { merge_sha: hit.merge_sha } : {},
        ...hit.url !== void 0 ? { url: hit.url } : {},
        detail: `PR #${hit.number} is MERGED on GitHub but the task is '${t.status}' \u2014 state lost the ship; verify the merge commit is on staging, then record it manually`
      });
    } else if (hit.state === "CLOSED" && CLOSED_DRIFT_STATUSES.includes(t.status)) {
      drifts.push({
        class: "closed-unmerged",
        ...base,
        recorded_pr_number: f.recorded_pr_number,
        pr_number: hit.number,
        pr_state: hit.state,
        ...hit.url !== void 0 ? { url: hit.url } : {},
        detail: `PR #${hit.number} was CLOSED without merging while the task is '${t.status}' \u2014 reopen the PR or let the next ship open a fresh one`
      });
    } else if (hit.state === "OPEN" && f.branch_tip === null) {
      drifts.push({
        class: "branch-missing",
        ...base,
        recorded_pr_number: f.recorded_pr_number,
        pr_number: hit.number,
        pr_state: hit.state,
        ...hit.url !== void 0 ? { url: hit.url } : {},
        detail: `PR #${hit.number} is OPEN but its head branch '${f.branch}' is gone on GitHub \u2014 re-push the local branch before resuming`
      });
    }
  } else {
    const open2 = f.prs.find((p) => p.state === "OPEN");
    if (open2 !== void 0) {
      drifts.push({
        class: "pr-unrecorded",
        ...base,
        pr_number: open2.number,
        pr_state: open2.state,
        ...open2.url !== void 0 ? { url: open2.url } : {},
        detail: `OPEN PR #${open2.number} exists on head '${f.branch}' but state records no pr_number \u2014 informational: the next ship's idempotent create rediscovers it`
      });
    }
  }
  return drifts;
}
function classifyDrift(run9, facts) {
  const drifts = [];
  for (const f of facts.tasks) {
    const t = run9.tasks[f.task_id];
    if (t !== void 0) {
      drifts.push(...classifyTask(t, f));
    }
  }
  if (!isTerminalRunStatus(run9.status) && facts.staging.tip === null) {
    drifts.push({
      class: "staging-missing",
      branch: facts.staging.branch,
      detail: `staging branch '${facts.staging.branch}' is gone on GitHub while the run is '${run9.status}' \u2014 re-push it from a local clone (or cancel the run) before resuming`
    });
  }
  if (facts.rollup !== void 0) {
    const landed = facts.rollup.recorded_number !== void 0 ? facts.rollup.prs.find((p) => p.number === facts.rollup?.recorded_number && p.state === "MERGED") : facts.rollup.prs.find((p) => p.state === "MERGED");
    if (landed !== void 0) {
      drifts.push({
        class: "rollup-landed",
        pr_number: landed.number,
        pr_state: landed.state,
        ...landed.merge_sha !== void 0 ? { merge_sha: landed.merge_sha } : {},
        ...landed.url !== void 0 ? { url: landed.url } : {},
        detail: `rollup PR #${landed.number} IS merged on GitHub but the run's marker says merged:false (a landed auto-arm) \u2014 \`factory rescue apply --run ${run9.run_id} --recheck-rollup\``
      });
    }
  }
  return drifts;
}
async function reconcileRun(run9, gh) {
  const facts = await gatherRunFacts(run9, gh);
  const drifts = classifyDrift(run9, facts);
  return { facts, drifts, rollup_landed: drifts.some((d) => d.class === "rollup-landed") };
}

// src/rescue/auto.ts
var SELF_HEAL_MAX_ATTEMPTS = 3;
function effectiveAutoResets(run9, scan) {
  const resets = new Set(scan.resettable.filter((id) => run9.tasks[id]?.failure_class !== "needs-context"));
  const clean = /* @__PURE__ */ new Map();
  function closureClean(id, visiting) {
    const memoized = clean.get(id);
    if (memoized !== void 0) {
      return memoized;
    }
    if (visiting.has(id)) {
      return true;
    }
    const task = run9.tasks[id];
    if (task === void 0) {
      return false;
    }
    const status = resets.has(id) ? "pending" : task.status;
    if (status === "failed") {
      clean.set(id, false);
      return false;
    }
    if (status === "done") {
      clean.set(id, true);
      return true;
    }
    visiting.add(id);
    const ok = task.depends_on.every((dep) => closureClean(dep, visiting));
    visiting.delete(id);
    clean.set(id, ok);
    return ok;
  }
  return scan.resettable.filter(
    (id) => resets.has(id) && nonNull(run9.tasks[id]).depends_on.every((dep) => closureClean(dep, /* @__PURE__ */ new Set([id])))
  );
}

// src/rescue/apply.ts
function reopenE2ePhase(phase) {
  if (phase.manifest.length === 0) {
    return void 0;
  }
  const {
    status: _status,
    reason: _reason,
    advisory: _advisory,
    ended_at: _endedAt,
    adjudication: _adjudication,
    ...rest
  } = phase;
  return rest;
}
function doneTaskRow(task, at2) {
  return {
    ...task,
    status: "done",
    ended_at: task.ended_at ?? at2,
    spawn_in_flight: void 0,
    e2e_feedback: void 0,
    fix_findings: void 0,
    review_dispositions: void 0,
    last_failing_gates: void 0,
    // D71: a shipped task carries no gate-failure streak
    failure_class: void 0,
    failure_reason: void 0
  };
}
function resetTaskRow(task, opts = {}) {
  const {
    failure_class: _failureClass,
    failure_reason: _failureReason,
    producer_role: _producerRole,
    test_revision_feedback: _testRevisionFeedback,
    // D71: the failing-gate streak is per-attempt evidence — never spans a rescue.
    last_failing_gates: _lastFailingGates,
    // The holdout evaluator-fault streak is per-attempt too (consecutive faults);
    // a rescued task starts with a fresh evaluator budget.
    holdout_evaluator_retries: _holdoutEvaluatorRetries,
    started_at: _startedAt,
    ended_at: _endedAt,
    phase: _phase,
    // WS2 hygiene: mirror completeTask/failTask (transitions.ts:88,112). A stale
    // checkpoint with escalation_rung reset to 0 would re-match the orchestrator's
    // idempotent re-spawn guard (orchestrator.ts:358-373) and hard-reset the freshly
    // recreated worktree to the pre-rescue tip_sha.
    spawn_in_flight: _spawnInFlight,
    // Kept by default (branch/PR pointers reused on retry — idempotent-create, Δ P);
    // only e2e-reopen opts in to dropping it, so the merged PR isn't rebound below.
    pr_number: _prNumber,
    ...rest
  } = task;
  return {
    ...rest,
    status: "pending",
    escalation_rung: 0,
    reviewers: [],
    merge_resyncs: 0,
    ...opts.clearShippedPr !== true && _prNumber !== void 0 ? { pr_number: _prNumber } : {},
    ...opts.e2eFeedback !== void 0 ? { e2e_feedback: opts.e2eFeedback } : {},
    // Decision 69: needs_context is NOT dropped above (the question survives the
    // reset); an answer, when given, is stamped alongside it.
    ...opts.answer !== void 0 && rest.needs_context !== void 0 ? { needs_context: { question: rest.needs_context.question, answer: opts.answer } } : {}
  };
}
function resetTasks(run9, targets, answer) {
  const nextTasks = { ...run9.tasks };
  for (const id of targets) {
    nextTasks[id] = resetTaskRow(nonNull(run9.tasks[id]), answer !== void 0 ? { answer } : {});
  }
  return nextTasks;
}
function reopenFields(reopen) {
  return reopen ? { status: "running", ended_at: null, terminal_reason: void 0 } : {};
}
function selectTargets(run9, opts) {
  const explicit = opts.tasks ?? [];
  if (explicit.length > 0) {
    const targets2 = [];
    const skipped = [];
    for (const id of explicit) {
      const task = run9.tasks[id];
      if (task === void 0) {
        throw new Error(`rescue: run '${run9.run_id}' has no task '${id}'`);
      }
      if (task.status === "done") {
        if (opts.adoptedDone?.includes(id) === true) {
          skipped.push(id);
          continue;
        }
        throw new Error(
          `rescue: refusing to reset shipped task '${id}' (status 'done') \u2014 would un-ship merged work`
        );
      }
      if (task.status === "pending") {
        skipped.push(id);
        continue;
      }
      targets2.push(id);
    }
    return { targets: targets2, skipped };
  }
  const scan = scanRun(run9);
  const targets = opts.includeDeadEnds === true ? [...scan.resettable, ...scan.dead_ends] : [...scan.resettable];
  return { targets, skipped: [] };
}
async function applyRescue(state, runId, opts = {}) {
  let result = null;
  if (opts.auto !== void 0 && ((opts.tasks?.length ?? 0) > 0 || opts.includeDeadEnds === true || opts.resetE2e === true || opts.recheckRollup === true || opts.resetTraceability === true || opts.answer !== void 0)) {
    throw new Error(
      "rescue: `auto` is mutually exclusive with manual target options (tasks/includeDeadEnds/resetE2e/recheckRollup/resetTraceability/answer)"
    );
  }
  if (opts.answer !== void 0 && (opts.tasks?.length ?? 0) !== 1) {
    throw new Error("rescue: `answer` requires exactly one explicit --task (the one that asked the question)");
  }
  const updated = await state.update(runId, (run9) => {
    if (opts.auto !== void 0) {
      const attempts = run9.self_heal?.attempts ?? 0;
      const noop = (blocked) => {
        result = {
          run_id: runId,
          run_status: run9.status,
          reset: [],
          reopened: false,
          skipped: [],
          auto_blocked: blocked,
          touched: false
        };
        return run9;
      };
      if (attempts >= SELF_HEAL_MAX_ATTEMPTS) {
        return noop("attempts");
      }
      const targets2 = effectiveAutoResets(run9, scanRun(run9));
      if (targets2.length === 0) {
        return noop("empty");
      }
      const reopen2 = isTerminalRunStatus(run9.status);
      result = {
        run_id: runId,
        run_status: reopen2 ? "running" : run9.status,
        reset: targets2,
        reopened: reopen2,
        skipped: [],
        self_heal_attempts: attempts + 1,
        touched: false
        // self-heal is not a human (S11)
      };
      return {
        ...run9,
        tasks: resetTasks(run9, targets2),
        self_heal: { attempts: attempts + 1, last_at: opts.auto.at },
        ...reopenFields(reopen2)
      };
    }
    if (opts.answer !== void 0) {
      const id = nonNull(opts.tasks?.[0]);
      if (run9.tasks[id]?.needs_context === void 0) {
        throw new Error(
          `rescue: task '${id}' has no recorded NEEDS_CONTEXT question \u2014 nothing for --answer to answer`
        );
      }
    }
    const { targets, skipped } = selectTargets(run9, opts);
    const wasTerminal = isTerminalRunStatus(run9.status);
    const e2eReset = opts.resetE2e === true && run9.e2e_phase?.status === "failed";
    const assessReset = opts.resetE2e === true && run9.e2e_assessment?.status === "failed";
    const traceReset = opts.resetTraceability === true && run9.traceability?.status === "failed";
    const rollupRecheck = opts.recheckRollup === true && run9.rollup?.merged === false;
    const reopen = wasTerminal && (targets.length > 0 || e2eReset || assessReset || traceReset || rollupRecheck);
    const didWork = targets.length > 0 || reopen || e2eReset || assessReset || traceReset || rollupRecheck;
    result = {
      run_id: runId,
      run_status: reopen ? "running" : run9.status,
      reset: targets,
      reopened: reopen,
      skipped,
      touched: didWork
    };
    if (!didWork) {
      return run9;
    }
    return {
      ...run9,
      tasks: resetTasks(run9, targets, opts.answer),
      // S11: a manual apply that did work IS a human touch.
      human_touches: [...run9.human_touches, { kind: "recover", at: opts.at ?? nowIso() }],
      ...e2eReset ? { e2e_phase: reopenE2ePhase(nonNull(run9.e2e_phase)) } : {},
      // Decision 40: drop the WHOLE failed assessment (no manifest worth preserving)
      // so wantsE2eAssessment re-fires a fresh assessor on the next drive.
      ...assessReset ? { e2e_assessment: void 0 } : {},
      // S9 (Decision 47): drop the WHOLE failed traceability marker so
      // wantsTraceability re-fires a fresh audit on the next drive.
      ...traceReset ? { traceability: void 0 } : {},
      ...reopenFields(reopen)
    };
  });
  return { ...nonNull(result), run_status: updated.status };
}

// src/rescue/adopt.ts
function planAdoptions(run9, report) {
  const done = [];
  const rebind = [];
  const clear = [];
  const repush = [];
  const surfaced = [];
  const factsFor = (taskId) => report.facts.tasks.find((t) => t.task_id === taskId);
  for (const d of report.drifts) {
    switch (d.class) {
      case "merged-unrecorded": {
        const tf = factsFor(d.task_id);
        const pr = tf?.prs.find((p) => p.number === d.pr_number);
        if (tf !== void 0 && pr?.baseRefName === run9.staging_branch) {
          done.push({
            task_id: tf.task_id,
            pr_number: pr.number,
            ...pr.merge_sha !== void 0 ? { merge_sha: pr.merge_sha } : {}
          });
        } else {
          surfaced.push(d);
        }
        break;
      }
      case "stale-pr-number": {
        const tf = factsFor(d.task_id);
        if (tf === void 0) {
          surfaced.push(d);
          break;
        }
        const opens = tf.prs.filter((p) => p.state === "OPEN");
        if (opens.length === 1) {
          rebind.push({ task_id: tf.task_id, pr_number: nonNull(opens[0]).number });
        } else {
          clear.push(tf.task_id);
        }
        break;
      }
      case "branch-missing": {
        const tf = factsFor(d.task_id);
        if (tf === void 0) {
          surfaced.push(d);
        } else {
          repush.push({ task_id: tf.task_id, branch: tf.branch });
        }
        break;
      }
      case "rollup-landed":
        break;
      case "closed-unmerged":
      case "pr-unrecorded":
      case "staging-missing":
        surfaced.push(d);
        break;
    }
  }
  let reopen = false;
  if (isTerminalRunStatus(run9.status)) {
    const doneIds = new Set(done.map((d) => d.task_id));
    const allMergedAfter = Object.values(run9.tasks).every((t) => t.status === "done" || doneIds.has(t.task_id));
    if (report.rollup_landed && run9.rollup?.merged === false) {
      reopen = "rollup";
    } else if (done.length > 0 && allMergedAfter) {
      reopen = "all-done";
    }
  }
  return { done, rebind, clear, repush, reopen, surfaced };
}
async function applyAdoptions(deps, runId, plan, opts) {
  const actions = [];
  const adopted = [];
  let reopened = false;
  const hasStateWork = plan.done.length > 0 || plan.rebind.length > 0 || plan.clear.length > 0 || plan.reopen !== false;
  if (hasStateWork) {
    await deps.state.update(runId, (run9) => {
      const tasks = { ...run9.tasks };
      for (const d of plan.done) {
        const t = tasks[d.task_id];
        if (t === void 0 || t.status === "done" || t.pr_number !== d.pr_number) {
          continue;
        }
        tasks[d.task_id] = doneTaskRow(t, opts.at);
        adopted.push(d.task_id);
        actions.push({ class: "merged-unrecorded", action: "done", task_id: d.task_id, pr_number: d.pr_number });
      }
      for (const r of plan.rebind) {
        const t = tasks[r.task_id];
        if (t === void 0 || t.status === "done" || t.pr_number === r.pr_number) {
          continue;
        }
        tasks[r.task_id] = { ...t, pr_number: r.pr_number };
        actions.push({
          class: "stale-pr-number",
          action: "rebind",
          task_id: r.task_id,
          pr_number: r.pr_number
        });
      }
      for (const id of plan.clear) {
        const t = tasks[id];
        if (t === void 0 || t.status === "done" || t.pr_number === void 0) {
          continue;
        }
        const { pr_number: _drop, ...rest } = t;
        tasks[id] = rest;
        actions.push({ class: "stale-pr-number", action: "clear", task_id: id });
      }
      let reopenFields2 = {};
      if (plan.reopen !== false && isTerminalRunStatus(run9.status)) {
        if (plan.reopen === "rollup" && run9.rollup?.merged === false) {
          reopened = "rollup";
        } else if (plan.reopen === "all-done" && Object.values(tasks).every((t) => t.status === "done")) {
          reopened = "all-done";
        }
        if (reopened !== false) {
          reopenFields2 = { status: "running", ended_at: null, terminal_reason: void 0 };
          actions.push({
            class: reopened === "rollup" ? "rollup-landed" : "all-done",
            action: "reopen"
          });
        }
      }
      return { ...run9, tasks, ...reopenFields2 };
    });
  }
  const repushed = [];
  const surfaced = [...plan.surfaced];
  for (const p of plan.repush) {
    if (await deps.git.branchExists(p.branch)) {
      await deps.git.push("origin", p.branch);
      repushed.push(p.branch);
      actions.push({ class: "branch-missing", action: "repush", task_id: p.task_id });
    } else {
      surfaced.push({
        class: "branch-missing",
        task_id: p.task_id,
        branch: p.branch,
        detail: `PR head branch '${p.branch}' is gone on GitHub and no local branch exists to re-push \u2014 re-create it from a clone before resuming`
      });
    }
  }
  return { actions, adopted, repushed, reopened, surfaced, changed: actions.length > 0 };
}
function adoptFromReport(deps, run9, report, opts) {
  return applyAdoptions(deps, run9.run_id, planAdoptions(run9, report), opts);
}
function summarizeAdoption(report) {
  const parts = [];
  if (report.adopted.length > 0) {
    parts.push(`${report.adopted.length} adopted done`);
  }
  const rebinds = report.actions.filter((a) => a.action === "rebind").length;
  const clears = report.actions.filter((a) => a.action === "clear").length;
  if (rebinds > 0) {
    parts.push(`${rebinds} pr rebound`);
  }
  if (clears > 0) {
    parts.push(`${clears} pr cleared`);
  }
  if (report.repushed.length > 0) {
    parts.push(`${report.repushed.length} branch re-pushed`);
  }
  if (report.reopened !== false) {
    parts.push(`reopened (${report.reopened})`);
  }
  if (report.surfaced.length > 0) {
    parts.push(`${report.surfaced.length} surfaced`);
  }
  return parts.length > 0 ? parts.join(", ") : "no adoptions";
}

// src/rescue/gc.ts
async function probeLeftovers(run9, gh) {
  const { owner, repo } = splitRepoSlug(run9.spec.repo);
  return {
    branch: await gh.branchExists(owner, repo, run9.staging_branch),
    protection: (await gh.repoProtection(owner, repo, run9.staging_branch)).enabled
  };
}
async function gcScan(runs, gh, staleDirs = []) {
  const findings = [];
  const suspended = [];
  for (const run9 of runs) {
    const terminal = isTerminalRunStatus(run9.status);
    if (!terminal && run9.status !== "suspended") {
      continue;
    }
    const live = await probeLeftovers(run9, gh);
    if (!live.branch && !live.protection) {
      continue;
    }
    if (terminal) {
      findings.push({
        run_id: run9.run_id,
        run_status: run9.status,
        staging_branch: run9.staging_branch,
        branch_exists: live.branch,
        protection_live: live.protection,
        banked: run9.status === "failed",
        hint: `factory rescue gc --apply --run ${run9.run_id}`
      });
    } else {
      suspended.push({
        run_id: run9.run_id,
        staging_branch: run9.staging_branch,
        updated_at: run9.updated_at,
        hint: `factory run cancel --run ${run9.run_id} --cleanup`
      });
    }
  }
  const stale = [];
  for (const dir of staleDirs) {
    let live;
    if (dir.staging_branch !== void 0 && dir.repo !== void 0) {
      const { owner, repo } = splitRepoSlug(dir.repo);
      live = {
        branch: await gh.branchExists(owner, repo, dir.staging_branch),
        protection: (await gh.repoProtection(owner, repo, dir.staging_branch)).enabled
      };
    }
    stale.push({
      run_id: dir.run_id,
      reason: dir.reason,
      ...dir.staging_branch !== void 0 ? { staging_branch: dir.staging_branch } : {},
      ...live !== void 0 ? { branch_exists: live.branch, protection_live: live.protection } : {},
      hint: `factory rescue gc --apply --run ${dir.run_id}`
    });
  }
  return { findings, suspended, stale };
}
async function gcApply(run9, gh) {
  const { owner, repo } = splitRepoSlug(run9.spec.repo);
  await gh.deleteProtection(owner, repo, run9.staging_branch);
  await gh.deleteRemoteBranch(owner, repo, run9.staging_branch);
  return { run_id: run9.run_id, staging_branch: run9.staging_branch };
}
async function gcApplyStale(dir, gh, deleteRun) {
  let tornDown;
  if (dir.staging_branch !== void 0 && dir.repo !== void 0) {
    const { owner, repo } = splitRepoSlug(dir.repo);
    await gh.deleteProtection(owner, repo, dir.staging_branch);
    await gh.deleteRemoteBranch(owner, repo, dir.staging_branch);
    tornDown = dir.staging_branch;
  }
  await deleteRun(dir.run_id);
  return {
    run_id: dir.run_id,
    ...tornDown !== void 0 ? { staging_branch: tornDown } : {},
    state_deleted: true
  };
}

// src/orchestrator/finalize.ts
var log22 = createLogger("finalize");
function prdDoneComment(report, rollupResult) {
  const prRef = rollupResult.url ? `[#${rollupResult.number}](${rollupResult.url})` : `#${rollupResult.number}`;
  return `PRD delivered \u2014 all ${report.totals.shipped} task(s) shipped via rollup PR ${prRef}.

Spec: \`${report.spec_id}\` \xB7 Run: \`${report.run_id}\``;
}
function rollupTitle(report) {
  return `factory: ${report.spec_id} \u2192 develop (PRD #${report.issue_number})`;
}
async function commentFailuresOnPrd(deps, run9, report) {
  if (report.failures.length === 0 && report.e2e_failure === void 0 && report.traceability_failure === void 0) {
    return false;
  }
  const marker = failureCommentMarker(report.run_id);
  const existing = await deps.gh.listIssueComments({
    repo: report.repo,
    number: report.issue_number
  });
  if (existing.some((body) => body.includes(marker))) {
    log22.info(`failure comment already posted for run '${report.run_id}' \u2014 skipping duplicate`);
    return false;
  }
  const selfHealEligible = (run9.self_heal?.attempts ?? 0) < SELF_HEAL_MAX_ATTEMPTS && effectiveAutoResets(run9, scanRun(run9)).length > 0;
  await deps.gh.issueComment({
    repo: report.repo,
    number: report.issue_number,
    body: renderFailureComment(report, selfHealEligible)
  });
  return true;
}
function deriveTerminalReason(run9, taskTerminal) {
  if (run9.e2e_phase?.status === "failed") {
    return `e2e phase failed: ${run9.e2e_phase.reason ?? "no reason recorded"}`;
  }
  if (run9.e2e_assessment?.status === "failed") {
    return `e2e assessment failed: ${run9.e2e_assessment.reason ?? "no reason recorded"}`;
  }
  if (run9.traceability?.status === "failed") {
    return `traceability audit failed: ${run9.traceability.reason ?? "no reason recorded"}`;
  }
  if (taskTerminal !== "failed") {
    return void 0;
  }
  const tasks = Object.values(run9.tasks);
  if (tasks.length === 0) {
    return "no tasks (nothing was shippable)";
  }
  const failed = tasks.filter((t) => t.status !== "done");
  const named = failed.slice(0, 3).map((t) => `${t.task_id}${t.failure_class ? ` (${t.failure_class})` : ""}`).join(", ");
  return `${failed.length} of ${tasks.length} task(s) failed: ${named}${failed.length > 3 ? ", \u2026" : ""}`;
}
async function finalizeRun(deps, runId) {
  const now = deps.nowIso ?? nowIso();
  const run9 = await deps.state.read(runId);
  const taskTerminal = decideFinalize(run9).run_status;
  const terminal = run9.e2e_phase?.status === "failed" || run9.e2e_assessment?.status === "failed" || run9.traceability?.status === "failed" ? "failed" : taskTerminal;
  const terminalReason = deriveTerminalReason(run9, taskTerminal);
  const gates = await resolveGatesInForce(deps.git);
  const report = buildPartialReport(
    { ...run9, status: terminal, ...terminal === "failed" ? { terminal_reason: terminalReason } : {} },
    deps.spec,
    { now, ...gates }
  );
  const markdown = renderPartialReportMarkdown(report);
  await atomicWriteFile(runReportPath(deps.dataDir, runId), markdown);
  await recordRunFinalized(deps.dataDir, report, { now });
  const failureCommentPosted = run9.debug ? false : await commentFailuresOnPrd(deps, run9, report);
  let rollupResult;
  if (terminal === "completed") {
    const stagingBranch = run9.staging_branch;
    await deps.git.fetch("origin", deps.config.git.baseBranch);
    const reconcile = await deps.git.tryMergeNoForce(stagingBranch, `origin/${deps.config.git.baseBranch}`);
    if (!reconcile.merged) {
      const reason = `forward-reconcile conflict merging origin/${deps.config.git.baseBranch} into ${stagingBranch}: ${reconcile.conflict}`;
      await deps.state.update(runId, (s) => ({ ...s, rollup: { merged: false, reason } }));
      throw new Error(
        `finalize: ${reason} \u2014 resolve the conflict on '${stagingBranch}', push, then \`factory resume\``
      );
    }
    await deps.git.push("origin", stagingBranch);
    rollupResult = await rollup({
      ghClient: deps.gh,
      stagingBranch,
      baseBranch: deps.config.git.baseBranch,
      title: rollupTitle(report),
      body: markdown,
      merge: deps.shipMode === "live",
      // A6: CI wait budget from config (minutes → polls); deps.rollup (tests)
      // still overrides.
      maxPolls: Math.ceil(deps.config.git.rollupCiWaitMinutes * 6e4 / DEFAULT_POLL_INTERVAL_MS),
      ...deps.rollup ?? {}
    });
    const rr = rollupResult;
    if (rollupResult.merged) {
      if (!run9.debug) {
        if (!rollupResult.resumed) {
          await deps.gh.issueComment({
            repo: report.repo,
            number: report.issue_number,
            body: prdDoneComment(report, rollupResult)
          });
        }
        await deps.gh.issueClose({
          repo: report.repo,
          number: report.issue_number
        });
      }
      await deps.gh.deleteProtection(deps.owner, deps.repo, stagingBranch);
      await deps.gh.deleteRemoteBranch(deps.owner, deps.repo, stagingBranch);
      if (!run9.debug) {
        try {
          await deps.git.fetch("origin", deps.config.git.baseBranch);
          const developTip = await deps.git.revParse(`origin/${deps.config.git.baseBranch}`);
          const done = Object.values(run9.tasks).filter((t) => t.status === "done");
          await appendLedgerEntries(
            deps.dataDir,
            run9.spec.repo,
            run9.spec.spec_id,
            done.map((t) => ({
              task_id: t.task_id,
              run_id: runId,
              ...t.pr_number !== void 0 ? { pr_number: t.pr_number } : {},
              shas: [developTip],
              verified_at: now,
              source: "shipped"
            }))
          );
        } catch (err) {
          log22.error(
            `shipped-ledger append failed for '${run9.spec.spec_id}' (finalize continues; the next run falls back to the ALREADY_SATISFIED verdict): ${String(err)}`
          );
        }
      }
    }
    await deps.state.update(runId, (s) => ({
      ...s,
      rollup: rr.merged ? void 0 : {
        number: rr.number,
        merged: false,
        ...rr.reason ? { reason: rr.reason } : {}
      }
    }));
  } else {
    log22.warn(`run '${runId}': ${terminal} \u2014 develop untouched (no rollup, PRD left open)`);
  }
  const rollupPending = rollupResult !== void 0 && !rollupResult.merged && rollupResult.reason !== "no-merge";
  if (!run9.debug && deps.config.git.developProtection === "run-scoped" && !rollupPending && !await deps.state.hasOtherActiveForRepo(run9.spec.repo, runId)) {
    await putBaselineProtection({
      ghClient: deps.gh,
      owner: deps.owner,
      repo: deps.repo,
      branch: deps.config.git.baseBranch,
      contexts: effectiveProfiles(
        deps.config.git,
        deps.targetRoot !== void 0 ? await loadRequiredCheckExtras(deps.targetRoot) : requiredCheckExtras(void 0)
      ).baseline
    });
  }
  const finalized = terminal === "completed" ? await deps.state.finalize(runId, "completed") : await deps.state.finalize(runId, "failed", terminalReason ?? "run failed (no cause recorded)");
  const rollupNote = rollupResult ? `, rollup #${rollupResult.number} merged=${rollupResult.merged}` + (rollupResult.merged ? "" : ` (${rollupResult.reason})`) : ", no rollup";
  log22.info(
    `run '${runId}' finalized: ${terminal} (${report.totals.shipped} shipped, ${report.totals.failed} failed` + (failureCommentPosted ? ", PRD failure comment posted" : "") + rollupNote + `)`
  );
  return {
    run: finalized,
    report,
    ...rollupResult ? { rollup: rollupResult } : {},
    failureCommentPosted
  };
}
async function resolveGatesInForce(git) {
  let root;
  try {
    root = await git.showToplevel();
  } catch (err) {
    return { gatesUnavailable: `repo root unresolved: ${err.message}` };
  }
  const load = await loadGateContract(root);
  switch (load.state) {
    case "ok":
      return { gates: enumerateGatesInForce(load.contract) };
    case "absent":
      return { gatesUnavailable: `contract absent at ${root}` };
    case "invalid":
      return { gatesUnavailable: `contract invalid: ${load.error}` };
  }
}

// src/orchestrator/transitions.ts
var log23 = createLogger("transitions");
function markInFlight(deps, runId, taskId, phase) {
  const status = phaseToInFlightStatus(phase);
  return deps.state.updateTask(runId, taskId, (t) => ({
    ...t,
    status,
    phase,
    started_at: t.started_at ?? nowIso()
  }));
}
async function completeTask(deps, runId, taskId) {
  await deps.state.updateTask(runId, taskId, (t) => doneTaskRow(t, nowIso()));
  return { done: true, outcome: { outcome: "done" } };
}
async function failTask(deps, runId, taskId, failureClass, reason) {
  log23.warn(`task '${taskId}' failed (${failureClass}): ${reason}`);
  await deps.state.updateTask(runId, taskId, (t) => ({
    ...t,
    status: "failed",
    failure_class: failureClass,
    failure_reason: reason,
    ended_at: t.ended_at ?? nowIso(),
    spawn_in_flight: void 0
    // WS2 hygiene: no spawn is in flight past a terminal task
  }));
}
async function failStep(deps, runId, taskId, failureClass, reason) {
  await failTask(deps, runId, taskId, failureClass, reason);
  return { done: true, outcome: { outcome: "failed", failure_class: failureClass, reason } };
}
async function escalateOrFail(deps, runId, taskId, decision, resumePhase) {
  if (decision.action === "fail") {
    return failStep(deps, runId, taskId, decision.failureClass, decision.reason);
  }
  const run9 = await deps.state.read(runId);
  const task = run9.tasks[taskId];
  if (task === void 0) {
    throw new Error(`transitions: task '${taskId}' vanished from run '${runId}'`);
  }
  if (task.escalation_rung >= ESCALATION_CAP) {
    return failStep(
      deps,
      runId,
      taskId,
      "capability-budget",
      `producer escalation cap (${ESCALATION_CAP}) reached without clearing the merge gate: ${decision.reason}`
    );
  }
  const nextRung = task.escalation_rung + 1;
  await deps.state.updateTask(runId, taskId, (t) => ({
    ...t,
    escalation_rung: nextRung,
    reviewers: []
  }));
  log23.info(`task '${taskId}' escalating to rung ${nextRung}; resuming at '${resumePhase}' (${decision.reason})`);
  return { done: false, phase: resumePhase };
}
function classifyProducerFailure(outcome) {
  if (outcome.status === "done") {
    throw new Error("transitions: classifyProducerFailure called on a 'done' outcome");
  }
  if (outcome.status === "needs-context" || outcome.status === "error" || outcome.status === "already-satisfied") {
    throw new Error(
      `transitions: classifyProducerFailure called on a '${outcome.status}' outcome \u2014 handled before classification (Decisions 69/70/71), never a ladder retry`
    );
  }
  return classifyFailure({
    kind: "producer-status",
    status: outcome.status,
    reason: outcome.reason
  });
}
async function applyProducerOutcome(deps, runId, taskId, opts, outcome) {
  if (outcome.status === "done") {
    await deps.state.updateTask(runId, taskId, (t) => ({
      ...t,
      producer_role: opts.role,
      // A completed test-writer re-run resolves any pending defect feedback — clear
      // it so a stale note never leaks into a later rung's regeneration.
      ...opts.role === "test-writer" ? { test_revision_feedback: void 0 } : {},
      // A completed producer (any role) resolves any open NEEDS_CONTEXT question
      // by construction (Decision 69) — clear it so a stale question never leaks.
      needs_context: void 0
    }));
    return { done: false, phase: opts.resumePhase };
  }
  if (outcome.status === "error") {
    log23.warn(
      `task '${taskId}' producer spawn produced no usable STATUS (${outcome.reason}) \u2014 re-spawning at the same rung (spends one spawn re-drive slot)`
    );
    return { done: false, phase: opts.phase };
  }
  if (outcome.status === "needs-context") {
    const run9 = await deps.state.read(runId);
    const asked = run9.tasks[taskId]?.needs_context !== void 0;
    await deps.state.updateTask(runId, taskId, (t) => ({
      ...t,
      // Refresh to the CURRENT question (dropping any spent answer) so rescue
      // always surfaces what the latest attempt actually asked.
      needs_context: { question: outcome.reason }
    }));
    if (asked) {
      return failStep(
        deps,
        runId,
        taskId,
        "needs-context",
        `producer needs context (asked twice without resolving): ${outcome.reason}`
      );
    }
    log23.warn(`task '${taskId}' producer asked NEEDS_CONTEXT \u2014 one same-rung re-ask with the question injected`);
    return { done: false, phase: opts.phase };
  }
  if (outcome.status === "already-satisfied") {
    throw new Error(
      `transitions: applyProducerOutcome called on an 'already-satisfied' outcome for task '${taskId}' \u2014 the claim must be engine-verified in record.ts first (Decision 70)`
    );
  }
  if (outcome.status === "test-defective") {
    if (opts.phase !== "exec") {
      log23.warn(
        `task '${taskId}' emitted 'test-defective' from non-exec role '${opts.role}' \u2014 re-spawning at the same rung (spends one spawn re-drive slot)`
      );
      return { done: false, phase: opts.phase };
    }
    await deps.state.updateTask(runId, taskId, (t) => ({
      ...t,
      test_revision_feedback: outcome.reason
    }));
    return escalateOrFail(deps, runId, taskId, classifyProducerFailure(outcome), "tests");
  }
  return escalateOrFail(deps, runId, taskId, classifyProducerFailure(outcome), opts.phase);
}

// src/orchestrator/paths.ts
import { join as join13 } from "node:path";
function taskWorktreePath(workDir, runId, taskId) {
  validateId(runId, "run-id");
  validateId(taskId, "task-id");
  return join13(workDir, runId, taskId);
}

// src/orchestrator/exempt.ts
function taskExemptReader(deps, worktree) {
  return new DefaultExemptReader({
    specDir: specDir(deps.dataDir, deps.spec.repo, deps.spec.spec_id),
    worktree
  });
}

// src/orchestrator/gate-context.ts
function buildGateContext(deps, runId, taskId, baseRef) {
  const worktree = taskWorktreePath(deps.workDir, runId, taskId);
  return {
    runId,
    taskId,
    worktree,
    baseRef,
    config: deps.config,
    tools: deps.tools,
    exemptReader: taskExemptReader(deps, worktree),
    ...deps.loadContract === void 0 ? {} : { loadContract: deps.loadContract },
    coverageStore: new FsCoverageStore(runCoverageDir(deps.dataDir, runId))
  };
}
async function appendHoldoutEvidence(deps, verdictStore, runId, taskId, rung, evidence) {
  const holdoutGate = await deriveHoldoutEvidence(
    deps.holdout,
    verdictStore,
    runId,
    taskId,
    rung,
    deps.config.quality.holdoutPassRate
  );
  if (holdoutGate !== void 0) {
    evidence.push(holdoutGate);
  }
}

// src/orchestrator/handlers.ts
import { join as join15 } from "node:path";

// src/orchestrator/design-system.ts
import { readdir as readdir3 } from "node:fs/promises";
import { join as join14, relative } from "node:path";
var FRONTEND_EXTENSION = /\.(?:tsx|jsx|vue|svelte|css|scss|less)$/i;
var FRONTEND_DIRECTORY = /(?:^|\/)(?:components|pages|app)\//i;
var DESIGN_SYSTEM_DOC = /design[-_]?system|style[-_]?guide|design[-_]?tokens|ui[-_]?guidelines/i;
var MAX_DEPTH = 4;
function isFrontendPath(path7) {
  return FRONTEND_EXTENSION.test(path7) || FRONTEND_DIRECTORY.test(path7.replaceAll("\\", "/"));
}
async function findDesignSystemDocs(repoRoot) {
  const docsRoot = join14(repoRoot, "docs");
  const matches = [];
  async function scan(dir, depth) {
    let entries;
    try {
      entries = await readdir3(dir, { withFileTypes: true });
    } catch (err) {
      if (dir === docsRoot && err.code === "ENOENT") {
        return;
      }
      throw err;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const absolute = join14(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < MAX_DEPTH) {
            await scan(absolute, depth + 1);
          }
          return;
        }
        if (entry.isFile()) {
          const repoRelative = relative(repoRoot, absolute).replaceAll("\\", "/");
          if (DESIGN_SYSTEM_DOC.test(repoRelative)) {
            matches.push(repoRelative);
          }
        }
      })
    );
  }
  await scan(docsRoot, 0);
  return matches.sort();
}

// src/orchestrator/handlers.ts
var PREFLIGHT_GIT_LOCK_TUNING = {
  ...DEFAULT_FILE_LOCK_TUNING,
  stale: 3e4,
  retries: 100,
  retryMinTimeout: 25,
  retryMaxTimeout: 1e3
};
function makePhaseHandlers(deps) {
  function requireTask3(ctx, phase) {
    if (ctx.task === void 0) {
      throw new Error(`handlers: phase '${phase}' requires a task but ctx.task is absent`);
    }
    return ctx.task;
  }
  function splitFor(config, runId, specTask) {
    return splitHoldout(specTask.acceptance_criteria, config.quality.holdoutPercent, `${runId}:${specTask.task_id}`);
  }
  function priorFailureNote(rung) {
    const prior = Math.max(0, rung - 1);
    return {
      rung: prior,
      summary: `prior attempt at rung ${prior} did not clear the merge gate`
    };
  }
  function e2eFeedbackNote(task) {
    return task.e2e_feedback !== void 0 ? [
      {
        rung: task.escalation_rung,
        summary: `An end-to-end journey test FAILED against this task's previously-shipped work: ${task.e2e_feedback}. Fix the underlying issue \u2014 implementation or test, whichever is wrong \u2014 so the journey passes.`
      }
    ] : [];
  }
  function needsContextNote(task) {
    if (task.needs_context === void 0) {
      return [];
    }
    const { question, answer } = task.needs_context;
    return [
      {
        rung: task.escalation_rung,
        summary: answer !== void 0 ? `A prior attempt stopped with NEEDS_CONTEXT and asked: "${question}". A human answered: "${answer}". Proceed using that answer.` : `A prior attempt stopped with NEEDS_CONTEXT and asked: "${question}". Resolve it from repo/spec evidence if at all possible; only if it is genuinely unanswerable from the repo and the spec, return STATUS: NEEDS_CONTEXT again (the task then stops and surfaces the question to a human).`
      }
    ];
  }
  async function producerSpawn(role, specTask, runId, rung, resumePhase, extraPriorFailures = [], confirmedBlockers) {
    const dial = dialForRung(specTask.risk_tier, rung, deps.config);
    const model = role === "test-writer" ? selectProducerModel("high", deps.config) : dial.model;
    const split = splitFor(deps.config, runId, specTask);
    const designSystemDocs = role === "implementer" && specTask.files.some(isFrontendPath) ? await deps.designSystemDocs() : [];
    const context = buildProducerContext({
      taskId: specTask.task_id,
      title: specTask.title,
      description: specTask.description,
      visibleCriteria: split.visible,
      files: specTask.files,
      rung,
      designSystemDocs,
      // Fix 2: the spec's tests_to_write reach the test-writer (the gate at
      // spec/gates.ts maps every criterion to one — dropping them here made the
      // producer re-derive coverage blind). Implementer works from the tests.
      ...role === "test-writer" ? { testsToWrite: specTask.tests_to_write } : {},
      // `extraPriorFailures` (e.g. a test-revision note) is injected regardless of
      // the rung dial — a defective RED test must be steered away from on the very
      // first regeneration (rung 1), where the generic dial note is still off.
      priorFailures: [...extraPriorFailures, ...dial.injectsPriorFailure ? [priorFailureNote(rung)] : []],
      // D5 fix-forward: a blocked verify's confirmed reviewer blockers ∪ gate-stderr
      // record (record.ts persisted it as `task.fix_findings`), recorded in as
      // concrete PATCH instructions rather than re-nuking the implementation.
      ...confirmedBlockers !== void 0 ? { confirmedBlockers } : {}
    });
    const worktree = taskWorktreePath(deps.workDir, runId, specTask.task_id);
    const request = parseSpawnRequest({
      resume_phase: resumePhase,
      agents: [
        {
          role,
          agent_type: AGENT_TYPE_BY_ROLE[role],
          model,
          // max_turns omitted — each producer's own frontmatter is the single
          // source of truth for its turn budget (single-source-of-truth).
          // 3b(i): the runner spawns this VERBATIM.
          prompt: renderProducerPrompt(context, worktree),
          // Effort is set ONLY once the dial has climbed the model to its ceiling
          // (rung ≥ 3 for sub-ceiling tasks, ≥ 2 for high-tier). Omitted ⇒ the agent
          // inherits the spawn default — never pass `effort: undefined`.
          ...dial.effort !== void 0 ? { effort: dial.effort } : {}
        }
      ]
    });
    return spawn2(request);
  }
  return {
    /**
     * preflight: create the per-task worktree forked off the staging tip (D12
     * base-is-staging-tip assertion lives inside createTaskWorktree), then advance
     * to the tests phase. The run-scoped branch is deterministic from (run, task),
     * so it is not threaded through state here — ship recomputes it.
     */
    async preflight(ctx) {
      const task = requireTask3(ctx, "preflight");
      const worktree = taskWorktreePath(deps.workDir, ctx.run.run_id, task.task_id);
      const staging = ctx.run.staging_branch;
      const lockScope = staging.replace(/[^\w.-]/g, "-");
      await withFileLock(
        {
          dir: join15(deps.dataDir, "locks"),
          lockfile: join15(deps.dataDir, "locks", `preflight-git-${lockScope}.lock`),
          label: `preflight git '${staging}'`,
          dirPolicy: "create",
          tuning: PREFLIGHT_GIT_LOCK_TUNING
        },
        () => createTaskWorktree({
          gitClient: deps.git,
          runId: ctx.run.run_id,
          taskId: task.task_id,
          path: worktree,
          base: staging
        })
      );
      await (deps.provision ?? provisionWorktree)({
        path: worktree,
        setupCommand: deps.config.quality.setupCommand
      });
      return advance("tests");
    },
    /**
     * tests: PERSIST the holdout answer-key (the only phase that does — exec merely
     * recomputes the split), then either skip the test-writer (tdd_exempt → advance
     * to exec) or spawn the test-writer for the current rung (resume at exec).
     */
    async tests(ctx) {
      const task = requireTask3(ctx, "tests");
      const specTask = specTaskOf(deps.spec, task.task_id);
      const split = splitFor(deps.config, ctx.run.run_id, specTask);
      if (split.withheld.length > 0) {
        await deps.holdout.put(
          ctx.run.run_id,
          makeHoldoutRecord(task.task_id, split.withheld, specTask.acceptance_criteria.length)
        );
      }
      if (specTask.tdd_exempt === true) {
        return advance("exec");
      }
      const revisionNote = task.test_revision_feedback !== void 0 ? [
        {
          rung: task.escalation_rung,
          summary: `Your PRIOR test for this task was rejected as INCORRECT by the implementer and reviewers: ${task.test_revision_feedback}. Write a BEHAVIORAL test derived from the acceptance criteria \u2014 do NOT pin an implementation source literal (no toContain("<source string>")).`
        }
      ] : [];
      return producerSpawn(
        "test-writer",
        specTask,
        ctx.run.run_id,
        task.escalation_rung,
        "exec",
        [...revisionNote, ...e2eFeedbackNote(task), ...needsContextNote(task)],
        // D70: a rejected ALREADY_SATISFIED claim (or any tests-routed send-back)
        // persists fix_findings — thread them so the test-writer sees the rejection.
        task.fix_findings
      );
    },
    /**
     * exec: spawn the implementer for the current rung against the holdout-stripped
     * visible criteria (recomputed from the same seed — never re-persisted), resume
     * at verify.
     */
    async exec(ctx) {
      const task = requireTask3(ctx, "exec");
      const specTask = specTaskOf(deps.spec, task.task_id);
      return producerSpawn(
        "implementer",
        specTask,
        ctx.run.run_id,
        task.escalation_rung,
        "verify",
        [...e2eFeedbackNote(task), ...needsContextNote(task)],
        // D5 fix-forward: a prior blocked verify's confirmed reviewer blockers ∪
        // gate-stderr record (record.ts persisted it on the wait-retry branch) —
        // patches the specific verified misses instead of re-nuking.
        task.fix_findings
      );
    },
    /**
     * verify reporter: run the deterministic gates, then either spawn the
     * risk-invariant panel (no reviewers yet) or DERIVE the merge gate from the
     * already-recorded reviewers + gate evidence. Holdout evidence is recorded
     * separately by the orchestrator (the holdout-validator runs as an out-of-band holdout);
     * this reporter never spawns.
     */
    async verify(ctx) {
      const task = requireTask3(ctx, "verify");
      const worktree = taskWorktreePath(deps.workDir, ctx.run.run_id, task.task_id);
      const gateCtx = buildGateContext(deps, ctx.run.run_id, task.task_id, ctx.run.staging_branch);
      const gate = await new GateRunner().run(gateCtx);
      const dbApplicable = await touchesDatabase(deps.tools.git, gateCtx.baseRef, { cwd: worktree });
      const expectedRoster = panelRolesFor(dbApplicable);
      const panelSpawn = async () => {
        const crossVendor = await resolveCodexCrossVendor(deps.config.codex.model, deps.vendorProbe);
        if (deps.config.review.requireCrossVendor === "block" && crossVendor.status === "absent") {
          return taskFailed(
            "blocked-environmental",
            `environmental blocker: cross-vendor reviewer required (review.requireCrossVendor=block) but absent: ${crossVendor.reason}`
          );
        }
        const priorDispositions = renderDispositionLedger(task.review_dispositions);
        const crossVendorPrompt = crossVendor.status === "present" ? await composeCrossVendorPrompt({
          pluginRoot: resolvePluginRoot(),
          baseRef: gateCtx.baseRef,
          worktree,
          ...priorDispositions !== void 0 ? { priorDispositions } : {}
        }) : void 0;
        return spawn2(buildPanelManifest("verify", crossVendor, dbApplicable, crossVendorPrompt));
      };
      if (task.reviewers.length < expectedRoster.length) {
        return panelSpawn();
      }
      const holdoutExpected = await deps.holdout.has(ctx.run.run_id, task.task_id);
      const fastPathEvidence = [...gate.evidence];
      if (holdoutExpected) {
        const verdictStore = new FsHoldoutVerdictStore(deps.dataDir);
        const hasVerdicts = await verdictStore.has(ctx.run.run_id, task.task_id, task.escalation_rung);
        if (!hasVerdicts) {
          return panelSpawn();
        }
        await appendHoldoutEvidence(
          deps,
          verdictStore,
          ctx.run.run_id,
          task.task_id,
          task.escalation_rung,
          fastPathEvidence
        );
      }
      const mergeGate = deriveMergeGateVerdict({ reviewers: task.reviewers }, fastPathEvidence);
      if (mergeGate.passed) {
        return advance("ship");
      }
      return waitRetry(
        "verify",
        // fastPathEvidence (not gate.evidence): includes the holdout gate that may be
        // the actual blocker, so the reason names the real cause instead of a generic fallback.
        mergeGateBlockReason(task.reviewers, fastPathEvidence),
        ctx.attempt ?? 1,
        ESCALATION_CAP + 1
      );
    },
    /**
     * ship — NOT served from this reporter. The orchestrator runs the stateful
     * {@link import("./ship.js").shipTask} directly (PR pointer writes + the live
     * MergeSerializer), since a reporter can neither write state nor merge; the
     * orchestrator intercepts `ship` before {@link import("./engine.js").runPhase} can
     * ever dispatch it here.
     *
     * This method exists ONLY to keep {@link PhaseHandlers} TOTAL — the engine's
     * exhaustive per-task phase switch (engine.ts) requires a handler for every
     * `TaskPhase`. Its body is a LOUD throw: routing `ship` through `runPhase` is a
     * programming error (it would re-open the PR with none of shipTask's state
     * writes), so it fails fast rather than silently drifting from the live path.
     * (`shipBody` / `specTaskOf` remain exported below — `ship.ts` is their caller.)
     */
    ship(_ctx) {
      throw new Error("ship is routed to shipTask; runPhase must never dispatch ship");
    },
    /**
     * finalize (run-level, terminal-by-construction): the pure {@link decideFinalize}
     * over the run's task-status map. Throws if any task is non-terminal (it must
     * never be called with in-flight work) — never spins.
     */
    finalize(ctx) {
      return Promise.resolve(decideFinalize(ctx.run));
    }
  };
}
function specTaskOf(spec, taskId) {
  const found = spec.tasks.find((t) => t.task_id === taskId);
  if (found === void 0) {
    throw new Error(`handlers: task '${taskId}' is not present in spec '${spec.spec_id}' \u2014 run/spec drift`);
  }
  return found;
}
function shipBody(runId, specTask) {
  return [
    `Factory task \`${specTask.task_id}\` \u2014 ${specTask.title}`,
    "",
    specTask.description,
    "",
    `Run: \`${runId}\``,
    `Risk tier: ${specTask.risk_tier}`
  ].join("\n");
}

// src/orchestrator/docs-applicable.ts
import { readFile as readFile13, stat } from "node:fs/promises";
import { join as join16 } from "node:path";
async function readJsonOrNull2(file) {
  let raw;
  try {
    raw = await readFile13(file, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function docsEnabled(packageJson) {
  const enabled = packageJson?.factory?.docs?.enabled;
  return enabled !== false;
}
async function isDocsApplicable(repoRoot) {
  try {
    const s = await stat(join16(repoRoot, "docs"));
    if (!s.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  return docsEnabled(await readJsonOrNull2(join16(repoRoot, "package.json")));
}

// src/orchestrator/record.ts
import { readFile as readFile14 } from "node:fs/promises";
import { sep as sep3 } from "node:path";
var log24 = createLogger("record");
async function persistStepCursor(deps, runId, taskId, step) {
  if (!step.done) {
    await markInFlight(deps, runId, taskId, step.phase);
  }
}
async function readJsonInput(path7) {
  const raw = await readFile14(path7, "utf8");
  return parseJson(raw, path7);
}
function producerPhaseInfo(phase) {
  if (phase === "tests") {
    return { role: "test-writer", phase: "tests", after: "exec" };
  }
  if (phase === "exec") {
    return { role: "implementer", phase: "exec", after: "verify" };
  }
  throw new UsageError(`phase must be a producer phase (tests | exec), got '${phase}'`);
}
async function applyRecordProducer(deps, runId, taskId, phase, statusLine) {
  const { state } = deps;
  const info = producerPhaseInfo(phase);
  if (nextPhase(info.phase) !== info.after) {
    throw new Error(`record-producer: phase order drift \u2014 nextPhase('${info.phase}') !== '${info.after}'`);
  }
  const run9 = await state.read(runId);
  if (run9.tasks[taskId] === void 0) {
    throw new Error(`record-producer: run '${runId}' has no task '${taskId}'`);
  }
  const outcome = parseProducerStatus(statusLine);
  if (outcome.status === "already-satisfied") {
    const step2 = await verifyAlreadySatisfied(deps, run9, taskId, info.phase, outcome);
    await persistStepCursor({ state }, runId, taskId, step2);
    return { run_id: runId, task_id: taskId, step: step2 };
  }
  const step = await applyProducerOutcome(
    { state },
    runId,
    taskId,
    { role: info.role, phase: info.phase, resumePhase: info.after },
    outcome
  );
  await persistStepCursor({ state }, runId, taskId, step);
  return { run_id: runId, task_id: taskId, step };
}
async function verifyAlreadySatisfied(deps, run9, taskId, phase, outcome) {
  const runId = run9.run_id;
  const task = run9.tasks[taskId];
  if (task === void 0) {
    throw new Error(`record-producer: run '${runId}' has no task '${taskId}'`);
  }
  const worktree = taskWorktreePath(deps.workDir, runId, taskId);
  const reject = async (why) => {
    const reason = `ALREADY_SATISFIED claim rejected: ${why}`;
    log24.warn(`task '${taskId}': ${reason}`);
    await deps.state.updateTask(runId, taskId, (t) => ({
      ...t,
      fix_findings: [{ reviewer: "already-satisfied-verifier", description: reason }]
    }));
    return escalateOrFail(deps, runId, taskId, { action: "retry", reason }, phase);
  };
  const checkpoint = task.spawn_in_flight;
  if (checkpoint?.phase !== phase || checkpoint.rung !== task.escalation_rung) {
    return reject("no matching spawn checkpoint \u2014 the pre-producer tip cannot be established");
  }
  if (outcome.shas.length === 0) {
    return reject("no commit SHAs cited as evidence");
  }
  await deps.git.resetHardClean(checkpoint.tip_sha, { cwd: worktree });
  for (const sha of outcome.shas) {
    let resolved;
    try {
      resolved = await deps.git.revParse(sha, { cwd: worktree });
    } catch {
      return reject(`cited SHA '${sha}' does not exist in the repository`);
    }
    let base;
    try {
      base = await deps.git.mergeBase(resolved, checkpoint.tip_sha, { cwd: worktree });
    } catch {
      return reject(`cited SHA '${sha}' shares no history with the task base`);
    }
    if (base !== resolved) {
      return reject(`cited SHA '${sha}' is not an ancestor of the task base \u2014 new work is not evidence`);
    }
  }
  const gate = await new GateRunner().run({
    ...buildGateContext(deps, runId, taskId, run9.staging_branch),
    gates: ["test"]
  });
  const red = gate.evidence.filter((e) => !e.observed);
  if (red.length > 0) {
    return reject(
      `test gate is RED at the base tip (${red.map((e) => e.detail ?? e.gate).join("; ")}) \u2014 the base does not satisfy the task`
    );
  }
  await appendLedgerEntries(deps.dataDir, run9.spec.repo, run9.spec.spec_id, [
    {
      task_id: taskId,
      run_id: runId,
      shas: [...outcome.shas],
      verified_at: nowIso(),
      source: "already-satisfied"
    }
  ]);
  log24.info(
    `task '${taskId}' verified ALREADY_SATISFIED (${outcome.shas.join(", ")}) \u2014 completing without producer work`
  );
  return completeTask(deps, runId, taskId);
}
var HOLDOUT_EVALUATOR_RETRY_CAP = 2;
async function applyRecordHoldout(deps, runId, taskId, rung, verdictStore, raw) {
  if (!await deps.holdout.has(runId, taskId)) {
    throw new Error(
      `record-holdout: task '${taskId}' has no withheld answer key \u2014 nothing to validate (applyRecordHoldout must only record when the orchestrator surfaced a holdout holdout)`
    );
  }
  const record = await deps.holdout.get(runId, taskId);
  const classified = classifyHoldoutOutput(record, raw);
  const run9 = await deps.state.read(runId);
  const used = run9.tasks[taskId]?.holdout_evaluator_retries ?? 0;
  if (classified.kind === "evaluator-failure") {
    if (used >= HOLDOUT_EVALUATOR_RETRY_CAP) {
      const step2 = await escalateOrFail(
        deps,
        runId,
        taskId,
        classifyFailure({
          kind: "environmental",
          reason: `holdout evaluator produced malformed output ${used + 1} times (cap ${HOLDOUT_EVALUATOR_RETRY_CAP}): ${classified.reason}`
        }),
        "verify"
      );
      await persistStepCursor(deps, runId, taskId, step2);
      return { kind: "evaluator-failure", step: step2 };
    }
    await deps.state.updateTask(runId, taskId, (t) => ({
      ...t,
      holdout_evaluator_retries: used + 1,
      spawn_in_flight: void 0
    }));
    log24.warn(
      `holdout evaluator failure (retry ${used + 1}/${HOLDOUT_EVALUATOR_RETRY_CAP}): ${classified.reason} \u2014 re-running the verify wave at the same rung`
    );
    const step = { done: false, phase: "verify" };
    await persistStepCursor(deps, runId, taskId, step);
    return { kind: "evaluator-failure", step };
  }
  const verdicts = classified.verdicts;
  await verdictStore.put(runId, taskId, rung, verdicts);
  if (used > 0) {
    await deps.state.updateTask(runId, taskId, (t) => ({ ...t, holdout_evaluator_retries: void 0 }));
  }
  const check = checkHoldout(record, verdicts, deps.config.quality.holdoutPassRate);
  return { kind: "recorded", envelope: { run_id: runId, task_id: taskId, evidence: holdoutEvidence(check), check } };
}
var REPLAY_IDENTITY = "runner-replay";
async function buildWorktreeSource(worktree, reviews) {
  const files = /* @__PURE__ */ new Set();
  for (const review of reviews) {
    for (const finding of review.findings) {
      if (finding.file !== void 0) {
        files.add(finding.file);
      }
    }
  }
  const lines = /* @__PURE__ */ new Map();
  const root = canonicalizePath(worktree);
  for (const file of files) {
    const resolved = canonicalizePath(file, worktree);
    if (resolved !== root && !resolved.startsWith(root.endsWith(sep3) ? root : root + sep3)) {
      lines.set(file, null);
      continue;
    }
    try {
      const text = await readFile14(resolved, "utf8");
      lines.set(file, text.split("\n"));
    } catch (err) {
      if (!isEnoent(err)) {
        throw err;
      }
      lines.set(file, null);
    }
  }
  return { readLines: (file) => lines.get(file) ?? null };
}
function makeReplayRunnerFactory(input) {
  const byReviewer = /* @__PURE__ */ new Map();
  for (const v of input.verifications) {
    byReviewer.set(v.reviewer, v.verdicts);
  }
  return (review) => {
    const queues = /* @__PURE__ */ new Map();
    for (const v of byReviewer.get(review.reviewer) ?? []) {
      const key = `${v.file}:${v.line}`;
      const arr = queues.get(key) ?? [];
      arr.push(v);
      queues.set(key, arr);
    }
    return {
      identity: REPLAY_IDENTITY,
      confirm(finding) {
        const key = `${finding.file}:${finding.line}`;
        const next = queues.get(key)?.shift();
        if (next === void 0) {
          return Promise.reject(
            new Error(
              `record-reviews: no pre-recorded finding-verifier verdict for reviewer '${review.reviewer}' finding at ${key} \u2014 every citation-verified blocking finding must carry an runner-collected verdict`
            )
          );
        }
        return Promise.resolve({ holds: next.holds, note: next.note });
      }
    };
  };
}
function composeFixFindings(adjudicated, gateEvidence) {
  const fromReviewers = adjudicated.flatMap(
    (a) => a.confirmedBlockers.map((f) => ({
      reviewer: f.reviewer,
      ...f.file !== void 0 ? { file: f.file } : {},
      ...f.line !== void 0 ? { line: f.line } : {},
      description: f.description
    }))
  );
  const fromGates = gateEvidence.filter((g) => g.gate !== "holdout" && !g.observed).map((g) => ({ reviewer: g.gate, description: g.detail ?? `${g.gate} gate failed` }));
  return [...fromReviewers, ...fromGates];
}
function enforcePanelRoster(reviews, expectedRoles = PANEL_ROLES) {
  const expected = new Set(expectedRoles);
  const out = reviews.map((r) => {
    if (expected.has(r.reviewer)) {
      return r;
    }
    log24.warn(
      `panel roster: unknown reviewer '${r.reviewer}' \u2014 verdict demoted to error (only the ${expectedRoles.length} expected panel roles may gate)`
    );
    return { ...r, verdict: "error" };
  });
  const present = new Set(reviews.map((r) => r.reviewer));
  for (const role of expectedRoles) {
    if (!present.has(role)) {
      log24.warn(`panel roster: reviewer '${role}' missing from results \u2014 synthesized error verdict`);
      out.push({ reviewer: role, verdict: "error", findings: [] });
    }
  }
  return out;
}
async function applyRecordReviews(deps, runId, taskId, verdictStore, input) {
  const run9 = await deps.state.read(runId);
  const task = run9.tasks[taskId];
  if (task === void 0) {
    throw new Error(`record-reviews: run '${runId}' has no task '${taskId}'`);
  }
  const worktree = taskWorktreePath(deps.workDir, runId, taskId);
  const baseRef = run9.staging_branch;
  const dbApplicable = await touchesDatabase(deps.tools.git, baseRef, { cwd: worktree });
  const reviews = enforcePanelRoster(input.reviews.map(parseRawReview), panelRolesFor(dbApplicable));
  const source = await buildWorktreeSource(worktree, reviews);
  const makeRunner2 = makeReplayRunnerFactory(input);
  const gate = await new GateRunner().run(buildGateContext(deps, runId, taskId, baseRef));
  const gateEvidence = [...gate.evidence];
  await appendHoldoutEvidence(deps, verdictStore, runId, taskId, task.escalation_rung, gateEvidence);
  const panel = await runPanel({
    reviews,
    source,
    makeRunner: makeRunner2,
    gateEvidence,
    phase: "verify",
    attempt: task.escalation_rung + 1,
    maxAttempts: ESCALATION_CAP + 1,
    blockOnCrossVendorAbsence: deps.config.review.requireCrossVendor === "block",
    ...input.crossVendorAbsent !== void 0 ? { crossVendor: { status: "absent", reason: input.crossVendorAbsent.reason } } : {}
  });
  if (panel.crossVendorAbsence !== void 0) {
    log24.warn(
      `task '${taskId}' verify ran WITHOUT an independent cross-vendor reviewer: ` + panel.crossVendorAbsence.reason
    );
  }
  let step;
  let outcome;
  if (panel.result.kind === "advance") {
    const nextPhaseVal = panel.result.to;
    const nextStatus = phaseToInFlightStatus(nextPhaseVal);
    await deps.state.updateTask(runId, taskId, (t) => ({
      ...t,
      reviewers: [...panel.reviewerResults],
      phase: nextPhaseVal,
      status: nextStatus,
      // A passing verify clears any stale fix-forward record from a prior blocked round.
      fix_findings: void 0,
      // D71: ditto the failing-gate-set record — the gate passed, the streak is over.
      last_failing_gates: void 0,
      // D68: the disposition ledger has served its purpose once the gate passes.
      review_dispositions: void 0,
      // Δ U/S5: record (or clear) the absence for the pass that actually shipped.
      cross_vendor_absent: panel.crossVendorAbsence
    }));
    step = { done: false, phase: nextPhaseVal };
    outcome = "advance";
  } else if (panel.result.kind === "wait-retry") {
    if (deps.config.review.requireCrossVendor === "block" && panel.crossVendorAbsence !== void 0) {
      step = await escalateOrFail(
        deps,
        runId,
        taskId,
        classifyFailure({ kind: "environmental", reason: panel.crossVendorAbsence.reason }),
        "exec"
      );
      await persistStepCursor(deps, runId, taskId, step);
      outcome = "environmental";
    } else {
      const fixFindings = composeFixFindings(panel.adjudicated, gateEvidence);
      const round = task.escalation_rung + 1;
      const failingEvidence = gateEvidence.filter((g) => g.gate !== "holdout" && !g.observed);
      const failingGates = failingEvidence.map((g) => g.gate).sort();
      const prev = task.last_failing_gates;
      const sameGateSet = (a, b) => a.length === b.length && a.every((g, i) => g === b[i]);
      const repeatedSet = failingGates.length > 0 && prev !== void 0 && sameGateSet(failingGates, prev) && specTaskOf(deps.spec, taskId).tdd_exempt !== true;
      if (repeatedSet) {
        const detail = failingEvidence.map((g) => g.detail ?? `${g.gate} gate failed`).join("; ");
        await deps.state.updateTask(runId, taskId, (t) => ({
          ...t,
          test_revision_feedback: `merge gate failed twice consecutively with the identical failing gate set (${failingGates.join(", ")}): ${detail}`,
          // The streak record served its purpose; stale fix-forward instructions
          // target the OLD tests and must not steer the regenerated round.
          last_failing_gates: void 0,
          fix_findings: void 0,
          review_dispositions: appendDispositions(
            t.review_dispositions,
            composeDispositions(reviews, panel.adjudicated, round)
          )
        }));
      } else {
        await deps.state.updateTask(runId, taskId, (t) => ({
          ...t,
          fix_findings: fixFindings,
          last_failing_gates: failingGates.length > 0 ? failingGates : void 0,
          review_dispositions: appendDispositions(
            t.review_dispositions,
            composeDispositions(reviews, panel.adjudicated, round)
          )
        }));
      }
      step = await escalateOrFail(
        deps,
        runId,
        taskId,
        classifyFailure({ kind: "merge-gate-blocked", reason: panel.result.reason }),
        repeatedSet ? "tests" : "exec"
      );
      await persistStepCursor(deps, runId, taskId, step);
      outcome = "send-back";
    }
  } else {
    throw new Error(`record-reviews: unexpected panel result kind '${panel.result.kind}'`);
  }
  const funnelOf = new Map(panel.adjudicated.map((a) => [a.reviewer, a]));
  await emitMetric(deps.dataDir, runId, "review.round", {
    task_id: taskId,
    rung: task.escalation_rung,
    outcome,
    // Per-lens {reviewer, verdict, raised/cited/confirmed_blockers} so
    // `score --reviewers` can compute each lens's yield, send-back rate, and BOTH
    // funnel rates (citation_rate, confirm_rate) without re-reading state.
    reviewers: panel.reviewerResults.map((r) => {
      const funnel = funnelOf.get(r.reviewer);
      return {
        reviewer: r.reviewer,
        verdict: r.verdict,
        confirmed_blockers: r.confirmed_blockers,
        ...funnel !== void 0 ? { raised_blockers: funnel.raisedBlockers, cited_blockers: funnel.citedBlockers } : {}
      };
    }),
    ...panel.crossVendorAbsence !== void 0 ? { cross_vendor_absent: true } : {}
  });
  return {
    run_id: runId,
    task_id: taskId,
    step,
    reviewers: panel.reviewerResults,
    mergeGate: panel.mergeGate,
    ...panel.crossVendorAbsence !== void 0 ? { crossVendorAbsence: panel.crossVendorAbsence } : {}
  };
}

// src/orchestrator/results.ts
var ResultKeySchema = external_exports.object({ phase: external_exports.enum(SPAWN_PHASES), rung: external_exports.number().int().min(0) }).strict();
var ProducerResultSchema = external_exports.object({ status: external_exports.string().min(1) }).strict();
var HoldoutResultSchema = external_exports.object({ raw: external_exports.string().min(1) }).strict();
var ReviewsResultSchema = external_exports.object({
  reviews: external_exports.array(external_exports.unknown()).min(1),
  verifications: external_exports.array(
    external_exports.object({
      reviewer: external_exports.string().min(1),
      verdicts: external_exports.array(
        external_exports.object({
          file: external_exports.string().min(1),
          line: external_exports.number().int().positive(),
          holds: external_exports.boolean(),
          // `.min(1)` is hygiene, not an anti-fabrication measure: a runner
          // willing to synthesise `holds` will synthesise a note with it.
          // What it catches is a BROKEN verifier agent — an empty note means
          // no justification was reached, and recording that as a verdict is
          // worse than failing the parse LOUD.
          note: external_exports.string().min(1)
        }).strict()
      )
    }).strict()
  ),
  crossVendorAbsent: external_exports.object({ reason: external_exports.string().min(1) }).strict().optional()
}).strict();
var DriveResultsSchema = external_exports.object({
  result_key: ResultKeySchema,
  producer: ProducerResultSchema.optional(),
  holdout: HoldoutResultSchema.optional(),
  reviews: ReviewsResultSchema.optional()
}).strict().refine((r) => r.producer !== void 0 !== (r.reviews !== void 0), {
  message: "drive results must carry exactly one of 'producer' or 'reviews'"
}).refine((r) => r.holdout === void 0 || r.reviews !== void 0, {
  message: "'holdout' results only accompany 'reviews'"
});
function parseDriveResults(raw) {
  return DriveResultsSchema.parse(raw);
}
function isSpawnPhase(phase) {
  return SPAWN_PHASES.includes(phase);
}

// src/orchestrator/quota-gate.ts
var log25 = createLogger("quota-gate");
async function applyQuotaGate(deps, runId, ignoreQuota = false) {
  if (ignoreQuota) {
    return null;
  }
  const reading = await deps.usage.read();
  const decision = evaluate(reading, deps.config, deps.now());
  if (decision.kind === "proceed") {
    return null;
  }
  switch (decision.kind) {
    case "pause-5h":
    case "suspend-7d": {
      const patch = buildCheckpoint(decision);
      log25.warn(`run '${runId}' ${decision.kind}: ${decision.reason}`);
      const run9 = await deps.state.update(runId, (s) => ({
        ...s,
        status: patch.status,
        quota: patch.quota
      }));
      return {
        scope: decision.kind === "pause-5h" ? "5h" : "7d",
        reason: decision.reason,
        resets_at_epoch: decision.resetsAtEpoch,
        run: run9
      };
    }
    case "unavailable-halt": {
      const patch = buildUnavailableCheckpoint();
      log25.warn(`run '${runId}' quota unavailable \u2014 suspending: ${decision.reason}`);
      const run9 = await deps.state.update(runId, (s) => ({
        ...s,
        status: patch.status,
        quota: patch.quota
      }));
      return { scope: "unavailable", reason: decision.reason, run: run9 };
    }
    default:
      return assertNever(decision);
  }
}
function quotaStopFields(stop) {
  return {
    scope: stop.scope,
    reason: stop.reason,
    ...stop.resets_at_epoch !== void 0 ? { resets_at_epoch: stop.resets_at_epoch } : {}
  };
}

// src/orchestrator/ship.ts
var log26 = createLogger("ship");
function requireTask(ctx) {
  if (ctx.task === void 0) {
    throw new Error("ship: phase 'ship' requires a task but ctx.task is absent");
  }
  return ctx.task;
}
async function shipTask(deps, ctx) {
  const task = requireTask(ctx);
  const runId = ctx.run.run_id;
  const specTask = specTaskOf(deps.spec, task.task_id);
  const branch = runScopedBranch(runId, task.task_id);
  const cwd = taskWorktreePath(deps.workDir, runId, task.task_id);
  try {
    await deps.git.push("origin", branch, { setUpstream: true, cwd });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/non-fast-forward|fetch first|\[rejected\]/i.test(msg)) {
      throw err;
    }
    log26.warn(
      `task '${task.task_id}' push of '${branch}' rejected non-fast-forward \u2014 deleting the stale remote ref and retrying once`
    );
    await deps.gh.deleteRemoteBranch(deps.owner, deps.repo, branch);
    try {
      await deps.git.push("origin", branch, { setUpstream: true, cwd });
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      return taskFailed(
        "blocked-environmental",
        `ship: push of '${branch}' still rejected after deleting the stale remote ref \u2014 investigate origin manually: ${retryMsg}`
      );
    }
  }
  const pr = await createTaskPrIdempotent({
    ghClient: deps.gh,
    branch,
    title: specTask.title,
    body: shipBody(runId, specTask),
    base: ctx.run.staging_branch,
    // Gate the MERGED-PR fallback on the number state still remembers: a crash-resume
    // keeps pr_number (idempotent no-op), but e2e-reopen clears it so a fresh PR opens
    // for the reopened commits instead of rebinding the already-merged one. See pr.ts.
    knownPrNumber: task.pr_number
  });
  await deps.state.updateTask(runId, task.task_id, (t) => ({
    ...t,
    branch,
    pr_number: pr.number
  }));
  if (deps.shipMode !== "live") {
    return taskDone();
  }
  const serializer = new MergeSerializer({
    ghClient: deps.gh,
    owner: deps.owner,
    repo: deps.repo,
    stagingBranch: ctx.run.staging_branch,
    dataDir: deps.dataDir
  });
  const outcome = await serializer.merge(pr.number);
  if (outcome.merged) {
    log26.info(`task '${task.task_id}' merged PR #${pr.number} via ${outcome.via}`);
    return taskDone();
  }
  return waitRetry("ship", `serial merge refused (${outcome.reason})`, 1, 1);
}

// src/orchestrator/orchestrator.ts
var log27 = createLogger("orchestrator");
var MERGE_RESYNC_CAP = 8;
var SPAWN_REDRIVE_CAP = 2;
var HOLDOUT_MAX_TURNS = 40;
function requireTask2(run9, taskId) {
  const task = run9.tasks[taskId];
  if (task === void 0) {
    throw new Error(`orchestrator: run '${run9.run_id}' has no task '${taskId}'`);
  }
  return task;
}
function terminalOutcome(task) {
  if (task.status === "done") {
    return { outcome: "done" };
  }
  if (task.failure_class === void 0) {
    throw new Error(
      `orchestrator: terminal task '${task.task_id}' has no failure_class \u2014 schema invariant violated`
    );
  }
  if (task.failure_reason === void 0) {
    throw new Error(
      `orchestrator: terminal task '${task.task_id}' has no failure_reason \u2014 schema invariant violated`
    );
  }
  return {
    outcome: "failed",
    failure_class: task.failure_class,
    reason: task.failure_reason
  };
}
function asSpawnPhase(phase) {
  if (isSpawnPhase(phase)) {
    return phase;
  }
  throw new Error(`orchestrator: phase '${phase}' cannot spawn agents (only tests|exec|verify can) \u2014 unreachable`);
}
async function holdoutSidecar(deps, runId, taskId, baseRef) {
  if (!await deps.holdout.has(runId, taskId)) {
    return void 0;
  }
  const record = await deps.holdout.get(runId, taskId);
  const worktree = taskWorktreePath(deps.workDir, runId, taskId);
  return {
    kind: "holdout-validate",
    task_id: taskId,
    agent_type: GENERAL_PURPOSE_AGENT_TYPE,
    worktree,
    model: resolveReviewModel(deps.config),
    max_turns: HOLDOUT_MAX_TURNS,
    prompt: buildHoldoutPrompt(record, worktree, baseRef)
  };
}
async function recordResults(deps, runId, taskId, phase, task, results) {
  const { result_key } = results;
  if (!isSpawnPhase(phase)) {
    throw new Error(`drive: results given but phase '${phase}' spawns no agents`);
  }
  const spawnPhase = phase;
  if (result_key.phase !== spawnPhase || result_key.rung !== task.escalation_rung) {
    throw new Error(
      `drive: stale or duplicate results (result_key ${result_key.phase}/${result_key.rung} vs cursor ${spawnPhase}/${task.escalation_rung}) \u2014 re-invoke without results to get the current envelope`
    );
  }
  const record = deps;
  if (phase === "tests" || phase === "exec") {
    if (results.producer === void 0) {
      throw new Error(`drive: phase '${phase}' expects producer-status results`);
    }
    const env2 = await applyRecordProducer(record, runId, taskId, phase, results.producer.status);
    return env2.step;
  }
  if (results.reviews === void 0) {
    throw new Error("drive: phase 'verify' expects reviews results");
  }
  if (await deps.holdout.has(runId, taskId) && results.holdout === void 0) {
    throw new Error(
      `drive: task '${taskId}' has a withheld holdout answer key \u2014 verify results must include the holdout-validate raw output (results.holdout is missing)`
    );
  }
  const verdictStore = new FsHoldoutVerdictStore(deps.dataDir);
  if (results.holdout !== void 0) {
    const holdout = await applyRecordHoldout(
      record,
      runId,
      taskId,
      task.escalation_rung,
      verdictStore,
      results.holdout.raw
    );
    if (holdout.kind === "evaluator-failure") {
      return holdout.step;
    }
  }
  const env = await applyRecordReviews(record, runId, taskId, verdictStore, results.reviews);
  return env.step;
}
async function resyncShipRetry(deps, runId, taskId, stagingBranch, reason) {
  const worktree = taskWorktreePath(deps.workDir, runId, taskId);
  if (!await deps.git.worktreeExists(worktree)) {
    const step = await failStep(
      deps,
      runId,
      taskId,
      "blocked-environmental",
      `staging re-sync: task worktree missing (${worktree})`
    );
    return { kind: "done", step };
  }
  const resync = await resyncTaskBranchOntoStaging({
    git: deps.git,
    cwd: worktree,
    branch: runScopedBranch(runId, taskId),
    stagingBranch,
    // Issue #2: tag a non-FF resync merge commit with [task-id] so the TDD gate's
    // commit-tag check attributes it (tools.ts:793). An FF resync creates no commit,
    // so this is a harmless no-op there.
    message: `chore(sync): merge staging into task branch [${taskId}]`
  });
  if (!resync.merged) {
    const step = await failStep(
      deps,
      runId,
      taskId,
      "blocked-environmental",
      `staging re-sync conflict merging ${stagingBranch} into the task branch: ${resync.conflict}`
    );
    return { kind: "done", step };
  }
  const bumpedRun = await deps.state.updateTask(runId, taskId, (t) => {
    const merge_resyncs = t.merge_resyncs + 1;
    if (merge_resyncs > MERGE_RESYNC_CAP) {
      return { ...t, merge_resyncs };
    }
    return { ...t, merge_resyncs, phase: "exec", status: phaseToInFlightStatus("exec") };
  });
  const bumped = nonNull(bumpedRun.tasks[taskId], `orchestrator: task '${taskId}' vanished mid-resync`);
  if (bumped.merge_resyncs > MERGE_RESYNC_CAP) {
    const step = await failStep(
      deps,
      runId,
      taskId,
      "blocked-environmental",
      `serial-merge re-sync budget (${MERGE_RESYNC_CAP}) exhausted: ${reason}`
    );
    return { kind: "done", step };
  }
  log27.info(
    `task '${taskId}' merge refused (${reason}); re-routing to exec to re-sync (attempt ${bumped.merge_resyncs}/${MERGE_RESYNC_CAP})`
  );
  return { kind: "continue" };
}
function doneFromStep(runId, taskId, step) {
  if (!step.done) {
    throw new Error("orchestrator: terminal transition returned a non-terminal step");
  }
  return { kind: "done", run_id: runId, task_id: taskId, outcome: step.outcome };
}
async function nextAction(deps, runId, taskId, results) {
  let run9 = await deps.state.read(runId);
  let task = requireTask2(run9, taskId);
  if (isTerminalTaskStatus(task.status)) {
    return { kind: "done", run_id: runId, task_id: taskId, outcome: terminalOutcome(task) };
  }
  const stop = await applyQuotaGate(deps, runId, run9.ignore_quota);
  if (stop !== null) {
    return { kind: "pause", run_id: runId, task_id: taskId, ...quotaStopFields(stop) };
  }
  let phase = task.phase ?? "preflight";
  let cursorPersisted = false;
  if (results !== void 0) {
    const step = await recordResults(deps, runId, taskId, phase, task, results);
    if (step.done) {
      return { kind: "done", run_id: runId, task_id: taskId, outcome: step.outcome };
    }
    phase = step.phase;
    cursorPersisted = true;
  }
  const handlers = makePhaseHandlers(deps);
  for (; ; ) {
    run9 = cursorPersisted ? await deps.state.read(runId) : await markInFlight(deps, runId, taskId, phase);
    cursorPersisted = true;
    task = requireTask2(run9, taskId);
    const ctx = { run: run9, task, attempt: task.escalation_rung + 1 };
    const result = phase === "ship" ? await shipTask(deps, ctx) : await runPhase(phase, ctx, handlers);
    switch (result.kind) {
      case "advance": {
        phase = result.to;
        cursorPersisted = false;
        continue;
      }
      case "spawn-agents": {
        const spawnPhase = asSpawnPhase(phase);
        const expects = spawnPhase === "verify" ? "reviews" : "producer-status";
        const worktree = taskWorktreePath(deps.workDir, runId, taskId);
        const base_ref = `origin/${run9.staging_branch}`;
        const holdout = spawnPhase === "verify" ? await holdoutSidecar(deps, runId, taskId, base_ref) : void 0;
        const result_key = { phase: spawnPhase, rung: task.escalation_rung };
        if (await deps.git.worktreeExists(worktree)) {
          const inFlight = task.spawn_in_flight;
          if (inFlight?.phase === spawnPhase && inFlight.rung === task.escalation_rung) {
            const redrives = inFlight.redrives + 1;
            if (redrives > SPAWN_REDRIVE_CAP) {
              const step = await failStep(
                deps,
                runId,
                taskId,
                "blocked-environmental",
                `hung spawn: re-drive budget (${SPAWN_REDRIVE_CAP}) for phase '${spawnPhase}' rung ${task.escalation_rung} exhausted \u2014 the spawn repeatedly exceeded the wall clock (config stallTtlMinutes/hungSpawnMinutes) or died without a parseable STATUS (Decision 71) without ever delivering usable results`
              );
              return doneFromStep(runId, taskId, step);
            }
            await deps.git.resetHardClean(inFlight.tip_sha, { cwd: worktree });
            await deps.state.updateTask(runId, taskId, (t) => ({
              ...t,
              spawn_in_flight: { ...inFlight, spawned_at: deps.now(), redrives }
            }));
          } else {
            const tip_sha = await deps.git.revParse("HEAD", { cwd: worktree });
            await deps.state.updateTask(runId, taskId, (t) => ({
              ...t,
              spawn_in_flight: {
                phase: spawnPhase,
                rung: t.escalation_rung,
                tip_sha,
                spawned_at: deps.now(),
                redrives: 0
              }
            }));
          }
        }
        const priorDispositions = expects === "reviews" ? renderDispositionLedger(task.review_dispositions) : void 0;
        return {
          kind: "spawn",
          run_id: runId,
          task_id: taskId,
          phase: spawnPhase,
          result_key,
          request: result.request,
          ...holdout !== void 0 ? { holdout } : {},
          expects,
          worktree,
          base_ref,
          ...priorDispositions !== void 0 ? { prior_dispositions: priorDispositions } : {}
        };
      }
      case "task-terminal": {
        if (result.outcome.outcome === "done") {
          const step2 = await completeTask(deps, runId, taskId);
          return doneFromStep(runId, taskId, step2);
        }
        const step = await failStep(deps, runId, taskId, result.outcome.failure_class, result.outcome.reason);
        return doneFromStep(runId, taskId, step);
      }
      case "wait-retry": {
        if (result.phase === "ship") {
          const retry = await resyncShipRetry(deps, runId, taskId, run9.staging_branch, result.reason);
          if (retry.kind === "done") {
            return doneFromStep(runId, taskId, retry.step);
          }
          phase = "exec";
          cursorPersisted = true;
          continue;
        }
        const step = await escalateOrFail(
          deps,
          runId,
          taskId,
          classifyFailure({ kind: "merge-gate-blocked", reason: result.reason }),
          "exec"
        );
        if (step.done) {
          return { kind: "done", run_id: runId, task_id: taskId, outcome: step.outcome };
        }
        phase = step.phase;
        cursorPersisted = false;
        continue;
      }
      case "graceful-stop":
      case "finalize-terminal":
        throw new Error(`orchestrator: run-scope result '${result.kind}' surfaced at task scope`);
      default:
        return assertNever(result);
    }
  }
}

// src/orchestrator/docs.ts
import { join as join17 } from "node:path";

// src/orchestrator/stage-helpers.ts
async function ensureStageWorktree(git, opts) {
  if (!await git.worktreeExists(opts.worktree)) {
    const args = opts.branch !== void 0 ? ["-B", opts.branch, opts.worktree, opts.ref] : ["--detach", opts.worktree, opts.ref];
    await git.worktreeAdd(args);
    if (opts.provision !== void 0) {
      await opts.provision();
    }
  } else if (opts.resetIfExists) {
    await git.resetHardClean(opts.ref, { cwd: opts.worktree });
  }
}
async function publishToStaging(git, staging, branch) {
  await git.mergeFfOrCommit(staging, branch);
  await git.push("origin", staging);
}
function specTaskLines(spec) {
  return spec.tasks.map((t) => `  - ${t.task_id} \u2014 ${t.title}: ${t.acceptance_criteria.join("; ")}`).join("\n");
}

// src/orchestrator/docs.ts
var DOCS_MODEL = "sonnet";
var MAX_DOCS_ATTEMPTS = 2;
function docsWorktreePath(workDir, runId) {
  return join17(workDir, runId, ".docs");
}
function buildScribePrompt(worktree, baseRef) {
  return [
    "You are the factory scribe running the pipeline's documentation phase.",
    `1. cd into your worktree: ${worktree} (already checked out on the docs branch off the staging tip).`,
    `2. Determine the whole-PRD change set with: git diff ${baseRef}..HEAD`,
    "3. Update /docs (Di\xE1taxis) to reflect those changes, per agents/scribe.md.",
    "4. COMMIT your changes IN this worktree. Do NOT push (the engine pushes on record).",
    "5. If nothing material changed, make no commit.",
    'Finish with your terminal STATUS line and return it as {"status": "<line>"}.'
  ].join("\n");
}
async function runDocsEmit(deps, runId) {
  const run9 = await deps.state.read(runId);
  const staging = run9.staging_branch;
  const base = deps.config.git.baseBranch;
  const docsBranch = `docs-${runId}`;
  const worktree = docsWorktreePath(deps.workDir, runId);
  const baseRef = `origin/${base}`;
  await deps.git.fetch("origin", staging);
  await deps.git.fetch("origin", base);
  await ensureStageWorktree(deps.git, {
    worktree,
    ref: `origin/${staging}`,
    branch: docsBranch,
    resetIfExists: (run9.docs?.attempts ?? 0) >= 1
  });
  return {
    kind: "spawn",
    run_id: runId,
    agent_type: AGENT_TYPE_BY_ROLE.scribe,
    worktree,
    base_ref: baseRef,
    staging_branch: staging,
    docs_branch: docsBranch,
    model: DOCS_MODEL,
    prompt: buildScribePrompt(worktree, baseRef)
  };
}
var DocsResultsSchema = external_exports.object({ status: external_exports.string().min(1) }).strict();
async function runDocsRecord(deps, runId, results) {
  const run9 = await deps.state.read(runId);
  const staging = run9.staging_branch;
  const docsBranch = `docs-${runId}`;
  const worktree = docsWorktreePath(deps.workDir, runId);
  const outcome = parseProducerStatus(results.status);
  if (outcome.status === "done") {
    await publishToStaging(deps.git, staging, docsBranch);
    await removeWorktreeBestEffort(deps.git, worktree);
    await deps.state.update(runId, (s) => ({ ...s, docs: { status: "done", ended_at: nowIso() } }));
    return { kind: "done", run_id: runId };
  }
  const reason = "reason" in outcome ? outcome.reason : "docs phase failed";
  const attempts = (run9.docs?.attempts ?? 0) + 1;
  const docsRecord = { status: "failed", reason, attempts, ended_at: nowIso() };
  if (attempts >= MAX_DOCS_ATTEMPTS) {
    await deps.state.update(runId, (s) => ({ ...s, docs: docsRecord }));
    return { kind: "done", run_id: runId };
  }
  await deps.state.update(runId, (s) => ({
    ...s,
    status: "suspended",
    docs: docsRecord
  }));
  return { kind: "suspend", run_id: runId, reason };
}

// src/orchestrator/traceability.ts
import { join as join18 } from "node:path";
var TRACE_MODEL = "sonnet";
var MAX_TRACE_ATTEMPTS = 2;
function traceWorktreePath(workDir, runId) {
  return join18(workDir, runId, ".trace");
}
function buildAuditorPrompt(worktree, baseRef, requirements, spec) {
  const reqLines = requirements.map((r, i) => `R${i + 1}. ${r}`);
  const criteriaLines = spec.tasks.flatMap((t) => [
    `[${t.task_id}] ${t.title}:`,
    ...t.acceptance_criteria.map((c) => `  - ${c}`)
  ]);
  return [
    "You are the factory traceability auditor (agents/traceability-auditor.md).",
    `1. cd into your worktree: ${worktree} (detached checkout of the staging tip).`,
    `2. The whole-PRD change set is: git diff ${baseRef}..HEAD \u2014 judge ONLY that diff and the resulting tree.`,
    "3. The PRD requirements below are the AXIOM. For EACH one, hunt for credible evidence in the diff/tree that it is delivered AND exercised by tests.",
    "",
    "PRD requirements:",
    ...reqLines,
    "",
    "Spec acceptance criteria (context only \u2014 judge the requirements, not these):",
    ...criteriaLines,
    "",
    "Verdict rules: met = credible diff evidence, exercised by tests; partial = delivered incompletely or untested; unmet = no credible evidence in the diff/tree. Task statuses are NOT evidence.",
    "You are READ-ONLY: make NO commits, NO edits, NO pushes.",
    'Finish with your terminal STATUS line and return exactly {"status": "<line>", "verdicts": [{"index": <n>, "verdict": "met|partial|unmet", "evidence": "<cited evidence, \u2264500 chars>"}, ...]} \u2014 one verdict per requirement R1..Rn, index matching the number above.'
  ].join("\n");
}
async function readRequirements(deps, runId) {
  const run9 = await deps.state.read(runId);
  const prd = await new SpecStore({ dataDir: deps.dataDir }).readPrd(run9.spec.repo, run9.spec.spec_id);
  const requirements = extractPrdRequirements(prd.body);
  if (requirements.length === 0) {
    throw new Error(
      `traceability: PRD #${prd.issue_number} snapshot yields no extractable requirements \u2014 nothing to audit (the specifiability gate should have refused this PRD)`
    );
  }
  return requirements;
}
async function runTraceabilityEmit(deps, runId) {
  const run9 = await deps.state.read(runId);
  const staging = run9.staging_branch;
  const base = deps.config.git.baseBranch;
  const worktree = traceWorktreePath(deps.workDir, runId);
  const baseRef = `origin/${base}`;
  const requirements = await readRequirements(deps, runId);
  await deps.git.fetch("origin", staging);
  await deps.git.fetch("origin", base);
  await ensureStageWorktree(deps.git, {
    worktree,
    ref: `origin/${staging}`,
    resetIfExists: (run9.traceability?.attempts ?? 0) >= 1
  });
  return {
    kind: "spawn",
    run_id: runId,
    agent_type: TRACEABILITY_AUDITOR_AGENT_TYPE,
    worktree,
    base_ref: baseRef,
    staging_branch: staging,
    model: TRACE_MODEL,
    prompt: buildAuditorPrompt(worktree, baseRef, requirements, deps.spec)
  };
}
var TraceabilityResultsSchema = external_exports.object({
  status: external_exports.string().min(1),
  verdicts: external_exports.array(
    external_exports.object({
      index: external_exports.number().int().positive(),
      verdict: external_exports.enum(["met", "partial", "unmet"]),
      evidence: external_exports.string().min(1).max(500)
    }).strict()
  )
}).strict();
async function runTraceabilityRecord(deps, runId, results) {
  const run9 = await deps.state.read(runId);
  const worktree = traceWorktreePath(deps.workDir, runId);
  const outcome = parseProducerStatus(results.status);
  if (outcome.status === "done") {
    const requirements = await readRequirements(deps, runId);
    const byIndex = new Map(results.verdicts.map((v) => [v.index, v]));
    const covered = byIndex.size === results.verdicts.length && byIndex.size === requirements.length && requirements.every((_, i) => byIndex.has(i + 1));
    if (!covered) {
      throw new Error(
        `traceability: audit must carry exactly one verdict per requirement 1..${requirements.length}, got indices [${results.verdicts.map((v) => v.index).join(", ")}]`
      );
    }
    const rows = requirements.map((requirement, i) => {
      const v = getOrThrow(byIndex, i + 1);
      return { requirement, verdict: v.verdict, evidence: v.evidence };
    });
    const unmet = rows.filter((r) => r.verdict === "unmet");
    await removeWorktreeBestEffort(deps.git, worktree);
    if (unmet.length === 0) {
      await deps.state.update(runId, (s) => ({
        ...s,
        traceability: { status: "done", verdicts: rows, ended_at: nowIso() }
      }));
      return { kind: "done", run_id: runId };
    }
    const reason2 = `PRD requirements unmet: ` + unmet.map((r) => `"${r.requirement}"`).join("; ");
    await deps.state.update(runId, (s) => ({
      ...s,
      traceability: { status: "failed", reason: reason2, verdicts: rows, ended_at: nowIso() }
    }));
    return { kind: "failed", run_id: runId, reason: reason2 };
  }
  const reason = "reason" in outcome ? outcome.reason : "traceability phase failed";
  const attempts = (run9.traceability?.attempts ?? 0) + 1;
  const marker = {
    status: "failed",
    reason,
    attempts,
    verdicts: [],
    ended_at: nowIso()
  };
  if (attempts >= MAX_TRACE_ATTEMPTS) {
    await removeWorktreeBestEffort(deps.git, worktree);
    await deps.state.update(runId, (s) => ({ ...s, traceability: marker }));
    return { kind: "failed", run_id: runId, reason };
  }
  await deps.state.update(runId, (s) => ({
    ...s,
    status: "suspended",
    traceability: marker
  }));
  return { kind: "suspend", run_id: runId, reason };
}

// src/orchestrator/circuit-breaker.ts
var FAILURE_RATIO = 0.15;
function isNonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}
function evaluate2(input, config) {
  const { cumulativeFailures, totalTasks } = input;
  if (!isNonNegativeFinite(cumulativeFailures)) {
    return {
      tripped: true,
      arm: "fail-closed",
      reason: `circuit breaker fail-closed: cumulativeFailures is not a non-negative finite number (got ${String(cumulativeFailures)})`
    };
  }
  if (!isNonNegativeFinite(totalTasks)) {
    return {
      tripped: true,
      arm: "fail-closed",
      reason: `circuit breaker fail-closed: totalTasks is not a non-negative finite number (got ${String(totalTasks)})`
    };
  }
  const { maxConsecutiveFailures } = config;
  const proportional = Math.ceil(FAILURE_RATIO * totalTasks);
  const effectiveThreshold = Math.max(maxConsecutiveFailures, proportional);
  if (cumulativeFailures >= effectiveThreshold) {
    const derivation = proportional > maxConsecutiveFailures ? `ceil(${FAILURE_RATIO} \xD7 ${totalTasks} tasks)` : `floor maxConsecutiveFailures=${maxConsecutiveFailures}`;
    return {
      tripped: true,
      arm: "failures",
      reason: `max cumulative failures (${cumulativeFailures} >= ${effectiveThreshold}, from ${derivation})`
    };
  }
  return { tripped: false };
}

// src/orchestrator/circuit-breaker-gate.ts
async function applyCircuitBreaker(deps, runId) {
  const run9 = await deps.state.read(runId);
  const capabilityFailures = Object.values(run9.tasks).filter(
    (t) => t.status === "failed" && t.failure_class === "capability-budget"
  ).length;
  const verdict = evaluate2(
    { cumulativeFailures: capabilityFailures, totalTasks: Object.keys(run9.tasks).length },
    deps.config
  );
  return verdict.tripped ? verdict : null;
}

// src/orchestrator/next.ts
function condemned(run9) {
  return run9.e2e_phase?.status === "failed" || run9.e2e_assessment?.status === "failed";
}
async function wantsDocs(deps, run9) {
  if (run9.docs?.status === "done") {
    return false;
  }
  if ((run9.docs?.attempts ?? 0) >= MAX_DOCS_ATTEMPTS) {
    return false;
  }
  if (condemned(run9) || run9.traceability?.status === "failed") {
    return false;
  }
  if (decideFinalize(run9).run_status !== "completed") {
    return false;
  }
  return deps.docsApplicable();
}
function wantsTraceability(run9) {
  if (run9.debug) {
    return false;
  }
  if (run9.traceability?.status === "done") {
    return false;
  }
  if (run9.traceability?.status === "failed") {
    if (run9.traceability.verdicts.length > 0) {
      return false;
    }
    if ((run9.traceability.attempts ?? 0) >= MAX_TRACE_ATTEMPTS) {
      return false;
    }
  }
  if (condemned(run9)) {
    return false;
  }
  return decideFinalize(run9).run_status === "completed";
}
function wantsE2e(run9) {
  if (!run9.e2e) {
    return false;
  }
  if (run9.e2e_phase?.status !== void 0) {
    return false;
  }
  if (condemned(run9)) {
    return false;
  }
  return decideFinalize(run9).run_status === "completed";
}
function wantsE2eAssessment(run9, allTerminal, needsE2e) {
  if (!run9.e2e) {
    return false;
  }
  if (run9.e2e_assessment?.status !== void 0) {
    return false;
  }
  return !allTerminal || needsE2e;
}
async function nextTask(deps, runId) {
  let run9 = await deps.state.read(runId);
  const ctx = () => ({ run_id: runId, data_dir: deps.dataDir, ship_mode: run9.ship_mode });
  if (isTerminalRunStatus(run9.status)) {
    return { ...ctx(), kind: "done", run_status: run9.status };
  }
  if (Object.keys(run9.tasks).length === 0) {
    throw new UsageError(
      `run '${runId}' has zero tasks \u2014 half-created (creation crashed before task seeding); cancel it (\`factory run cancel --run ${runId} --cleanup\`) and re-run \`factory run create\``
    );
  }
  if (run9.status === "suspended" && run9.quota === void 0) {
    return {
      ...ctx(),
      kind: "pause",
      scope: "park",
      reason: "run is parked (suspended without a quota checkpoint) \u2014 `factory resume` to continue"
    };
  }
  const allTerminal = Object.values(run9.tasks).every((t) => isTerminalTaskStatus(t.status));
  const needsE2e = allTerminal && wantsE2e(run9);
  const needsAssessment = wantsE2eAssessment(run9, allTerminal, needsE2e);
  const needsTrace = allTerminal && !needsE2e && wantsTraceability(run9);
  const needsDocs = allTerminal && !needsE2e && !needsTrace && await wantsDocs(deps, run9);
  if (allTerminal && !needsE2e && !needsTrace && !needsDocs) {
    if (run9.status === "paused" || run9.status === "suspended") {
      const patch = clearCheckpoint();
      await deps.state.update(runId, (s) => ({ ...s, status: patch.status, quota: patch.quota }));
    }
    return { ...ctx(), kind: "finalize", cascade_failed: [] };
  }
  const stop = await applyQuotaGate(deps, runId, run9.ignore_quota);
  if (stop !== null) {
    return { ...ctx(), kind: "pause", ...quotaStopFields(stop) };
  }
  if (run9.status === "paused" || run9.status === "suspended") {
    const patch = clearCheckpoint();
    run9 = await deps.state.update(runId, (s) => ({
      ...s,
      status: patch.status,
      quota: patch.quota
    }));
  }
  if (needsAssessment) {
    return { ...ctx(), kind: "e2e-assessment" };
  }
  if (needsE2e) {
    return { ...ctx(), kind: "e2e" };
  }
  if (needsTrace) {
    return { ...ctx(), kind: "traceability" };
  }
  if (needsDocs) {
    return { ...ctx(), kind: "document" };
  }
  const cascadeFailed = [];
  for (; ; ) {
    run9 = await deps.state.read(runId);
    const blocked = Object.values(run9.tasks).filter(
      (t) => t.status === "pending" && t.depends_on.some((d) => isUnsatisfiableDep(run9, d))
    );
    if (blocked.length === 0) {
      break;
    }
    for (const t of blocked) {
      const unsatisfied = t.depends_on.find((d) => isUnsatisfiableDep(run9, d));
      if (unsatisfied === void 0) {
        throw new Error(
          `next: task '${t.task_id}' classified blocked but no unsatisfiable dep found \u2014 unreachable`
        );
      }
      await failTask(
        deps,
        runId,
        t.task_id,
        // Decision 72: the class names the CAUSE (a failed dependency, not the
        // environment) — rescue treats it recoverable; the breaker's equality
        // filter and the scoring enum need no change.
        "blocked-dependency",
        `dependency '${unsatisfied}' did not complete (failed or missing)`
      );
      cascadeFailed.push(t.task_id);
    }
  }
  const tasks = Object.values(run9.tasks);
  if (tasks.every((t) => isTerminalTaskStatus(t.status))) {
    return { ...ctx(), kind: "finalize", cascade_failed: cascadeFailed };
  }
  const breaker = await applyCircuitBreaker(deps, runId);
  if (breaker !== null) {
    for (const t of tasks.filter((x) => !isTerminalTaskStatus(x.status))) {
      await failTask(
        deps,
        runId,
        t.task_id,
        "blocked-environmental",
        `circuit breaker tripped: ${breaker.reason}`
      );
      cascadeFailed.push(t.task_id);
    }
    run9 = await deps.state.read(runId);
    return { ...ctx(), kind: "finalize", cascade_failed: cascadeFailed };
  }
  const ready = tasks.filter((t) => !isTerminalTaskStatus(t.status) && depsSatisfied(run9, t.depends_on));
  const inFlight = ready.filter((t) => t.status !== "pending").map((t) => t.task_id);
  const pending = ready.filter((t) => t.status === "pending").map((t) => t.task_id);
  const ordered = [...inFlight, ...pending];
  const ttlSeconds = deps.config.stallTtlMinutes * 60;
  const hungSeconds = deps.config.hungSpawnMinutes * 60;
  const spawnAge = (t) => t.spawn_in_flight === void 0 ? void 0 : deps.now() - t.spawn_in_flight.spawned_at;
  const stale = ready.filter((t) => {
    const age = spawnAge(t);
    return age !== void 0 && age > ttlSeconds && age <= hungSeconds;
  }).map((t) => t.task_id);
  const hung = ready.filter((t) => {
    const age = spawnAge(t);
    return age !== void 0 && age > hungSeconds;
  }).map((t) => t.task_id);
  if (ordered.length === 0) {
    const wedged = tasks.filter((t) => !isTerminalTaskStatus(t.status));
    const detail = wedged.map((t) => `${t.task_id}=${t.status}`).join(", ");
    for (const t of wedged) {
      await failTask(
        deps,
        runId,
        t.task_id,
        "spec-defect",
        `unrunnable: no ready task and no satisfiable path (dependency cycle/deadlock) \u2014 wedged set [${detail}]`
      );
      cascadeFailed.push(t.task_id);
    }
    run9 = await deps.state.read(runId);
    return { ...ctx(), kind: "finalize", cascade_failed: cascadeFailed };
  }
  return {
    ...ctx(),
    kind: "work",
    ready: ordered,
    cascade_failed: cascadeFailed,
    max_parallel: deps.config.maxParallelTasks,
    stale,
    hung
  };
}

// src/orchestrator/e2e-paths.ts
import { join as join19 } from "node:path";
var E2E_TEST_DIR = "e2e";
function e2eWorktreePath(workDir, runId) {
  return join19(workDir, runId, ".e2e-author");
}
function e2eRunWorktreePath(workDir, runId) {
  return join19(workDir, runId, ".e2e-run");
}
function e2eBaseProofWorktreePath(workDir, runId) {
  return join19(workDir, runId, ".e2e-base-proof");
}
function e2eThrowawayDir(workDir, runId) {
  return join19(workDir, runId, ".e2e-throwaway");
}
function e2eAdjudicateWorktreePath(workDir, runId) {
  return join19(workDir, runId, ".e2e-adjudicate");
}
function e2eBranchName(runId) {
  return `e2e-${runId}`;
}
function adjudicateBranchName(runId) {
  return `e2e-adjudicate-${runId}`;
}
function resolveBootConfig(cfg, run9) {
  const startCommand = cfg.startCommand ?? run9.e2e_assessment?.resolved?.start_command;
  const baseURL = cfg.baseURL ?? run9.e2e_assessment?.resolved?.base_url;
  return startCommand !== void 0 && baseURL !== void 0 ? { startCommand, baseURL } : null;
}
function e2eEnv(cfg, boot) {
  return {
    BASE_URL: boot.baseURL,
    FACTORY_E2E_START_COMMAND: boot.startCommand,
    FACTORY_E2E_READY_TIMEOUT_MS: String(cfg.readyTimeoutMs),
    FACTORY_E2E: "1"
  };
}
function scrubbedE2eEnv(cfg, boot) {
  const env = e2eEnv(cfg, boot);
  for (const key of ["PATH", "HOME"]) {
    const v = process.env[key];
    if (v !== void 0) {
      env[key] = v;
    }
  }
  return env;
}

// src/orchestrator/e2e-schemas.ts
var CONTROL_TITLE_PREFIX = "control:";
var E2eAdjudicationVerdictSchema = external_exports.object({
  spec_path: external_exports.string().min(1),
  verdict: external_exports.enum(["regression", "intentional-change"]),
  /** Plain-language explanation — surfaced verbatim on a regression fail. */
  reason: external_exports.string().min(1),
  /**
   * The authorizing task/spec language quoted verbatim. REQUIRED on every
   * intentional-change verdict — enforced at record (retry), not here, so a
   * missing citation reads as an incomplete response rather than a parse crash.
   */
  citation: external_exports.string().optional()
}).strict();
var E2eResultsSchema = external_exports.object({
  status: external_exports.string().min(1),
  /** Empty when the author judged no task in this run to be UI-facing. */
  manifest: external_exports.array(E2eManifestEntrySchema).default([]),
  /**
   * Explicit "nothing UI-facing" signal — must be `true` whenever `manifest` is
   * empty. Distinguishes a genuine no-op from a malformed/incomplete author
   * response that the `manifest` field's own `.default([])` would otherwise
   * silently paper over as an unremarkable green. Omitted/false + an empty
   * manifest is treated as ambiguous, not a silent pass.
   */
  no_ui_surface: external_exports.boolean().optional(),
  /**
   * The adjudication-results leg's payload (D7) — populated only when an
   * adjudication cursor is in flight (the cursor's presence in run state, not
   * any field here, is what routes the record; author results omit it).
   */
  verdicts: external_exports.array(E2eAdjudicationVerdictSchema).optional()
}).strict();

// src/orchestrator/e2e-author.ts
import { isAbsolute as isAbsolute2 } from "node:path";

// src/orchestrator/e2e-shared.ts
import { copyFile, mkdir as mkdir10, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname9 } from "node:path";
var log28 = createLogger("e2e");
var DefaultE2eFileOps = class {
  async copySpec(from, to) {
    await mkdir10(dirname9(to), { recursive: true });
    await copyFile(from, to);
  }
  async writeConfig(path7, contents) {
    await mkdir10(dirname9(path7), { recursive: true });
    await writeFile2(path7, contents);
  }
};
var E2E_AUTHOR_MODEL = "sonnet";
var MAX_AUTHOR_ATTEMPTS = 2;
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
function defaultE2ePhase() {
  return { manifest: [], reopen_counts: {} };
}
async function markDone(deps, runId, opts) {
  await deps.state.update(runId, (s) => ({
    ...s,
    e2e_phase: {
      ...s.e2e_phase ?? defaultE2ePhase(),
      status: "done",
      reason: void 0,
      advisory: opts.advisory,
      attempts: opts.attempts,
      ended_at: nowIso()
    }
  }));
}
async function markFailed(deps, runId, reason, attempts) {
  await deps.state.update(runId, (s) => ({
    ...s,
    e2e_phase: {
      ...s.e2e_phase ?? defaultE2ePhase(),
      status: "failed",
      reason,
      advisory: void 0,
      attempts: attempts ?? s.e2e_phase?.attempts,
      ended_at: nowIso()
    }
  }));
  log28.warn(`run '${runId}': e2e phase failed \u2014 ${reason}`);
}
function findEntry(manifest, spec) {
  return manifest.find((e) => specPathMatches(spec.file, e.spec_path));
}
function specPathMatches(file, specPath) {
  return file === specPath || file.endsWith(`/${specPath}`) || specPath.endsWith(`/${file}`);
}
function unattributableToolingFailure(r) {
  return !r.ok && r.specs.every((s) => s.status !== "failed");
}

// src/orchestrator/e2e-proof.ts
import { join as join20 } from "node:path";
function classifyBaseRun(specs) {
  const control = specs.filter((s) => s.title.toLowerCase().startsWith(CONTROL_TITLE_PREFIX));
  const journey = specs.filter((s) => !s.title.toLowerCase().startsWith(CONTROL_TITLE_PREFIX));
  return {
    hasControl: control.length > 0,
    controlGreen: control.length > 0 && control.every((s) => s.status === "passed"),
    journeyRed: journey.length > 0 && journey.every((s) => s.status === "failed")
  };
}
async function proveCriticals(deps, runId, critical, authorWorktree, boot) {
  const cfg = deps.config.e2e;
  const files = deps.files ?? new DefaultE2eFileOps();
  const tool = deps.playwright ?? new DefaultPlaywrightTool();
  const wtPath = e2eBaseProofWorktreePath(deps.workDir, runId);
  const base = `origin/${deps.config.git.baseBranch}`;
  await ensureStageWorktree(deps.git, {
    worktree: wtPath,
    ref: base,
    branch: `e2e-base-proof-${runId}`,
    resetIfExists: false,
    provision: () => (deps.provision ?? provisionWorktree)({
      path: wtPath,
      setupCommand: deps.config.quality.setupCommand
    })
  });
  try {
    for (const entry of critical) {
      await files.copySpec(join20(authorWorktree, entry.spec_path), join20(wtPath, entry.spec_path));
      let baseResult;
      try {
        baseResult = await runE2e(
          {
            cwd: wtPath,
            env: scrubbedE2eEnv(cfg, boot),
            replaceEnv: true,
            testDir: entry.spec_path
          },
          tool
        );
      } catch (err) {
        return {
          ok: false,
          reason: `fail-first proof: e2e tooling error running '${entry.spec_path}' against the base app: ${errText(err)}`
        };
      }
      const { hasControl, controlGreen, journeyRed } = classifyBaseRun(baseResult.specs);
      if (!hasControl) {
        return {
          ok: false,
          reason: `fail-first proof: '${entry.spec_path}' has no "${CONTROL_TITLE_PREFIX}"-titled assertion \u2014 cannot verify the base app booted (required by the authoring contract)`
        };
      }
      if (!controlGreen) {
        return {
          ok: false,
          reason: `fail-first proof: base worktree unusable for '${entry.spec_path}' \u2014 its control assertion failed against the unmodified base app`
        };
      }
      if (!journeyRed) {
        return {
          ok: false,
          reason: `fail-first proof: '${entry.spec_path}' did not fail against the base app (vacuous-pass risk) \u2014 rejected`
        };
      }
      let stagingResult;
      try {
        stagingResult = await runE2e(
          {
            cwd: authorWorktree,
            env: scrubbedE2eEnv(cfg, boot),
            replaceEnv: true,
            testDir: entry.spec_path
          },
          tool
        );
      } catch (err) {
        return {
          ok: false,
          reason: `fail-first proof: e2e tooling error running '${entry.spec_path}' against staging: ${errText(err)}`
        };
      }
      if (!stagingResult.ok) {
        return {
          ok: false,
          reason: `fail-first proof: '${entry.spec_path}' is still red against staging`
        };
      }
    }
    return { ok: true, reason: "" };
  } finally {
    await removeWorktreeBestEffort(deps.git, wtPath);
  }
}

// src/orchestrator/e2e-suite.ts
import { join as join21 } from "node:path";
var log29 = createLogger("e2e");
function buildAdjudicationPrompt(args) {
  const taskLines = specTaskLines(args.spec);
  const specLines = (rows) => rows.map((s) => {
    const detail = s.error === void 0 ? "" : `
    ${s.error.replace(/\n/g, "\n    ")}`;
    return `  - ${s.spec_path} \u2014 "${s.title}"${detail}`;
  }).join("\n");
  const adjudicate = args.cursor.specs.filter((s) => s.mode === "adjudicate");
  const update = args.cursor.specs.filter((s) => s.mode === "update");
  const lines = [
    "You are the factory e2e-adjudicator: pre-existing committed e2e specs are failing against staging and no manifest entry maps them to a task in this run. Decide whether each failure is a REGRESSION this run introduced or an INTENTIONAL behavior change this run's spec authorizes.",
    `1. cd into your worktree: ${args.worktree} (checked out on the adjudication branch off the staging tip).`,
    `2. Boot the app: \`${args.boot.startCommand}\` \u2192 ${args.boot.baseURL} (reuse if already running).`,
    "3. The tasks this run delivered (the ONLY authority for 'intentional'):",
    taskLines
  ];
  if (adjudicate.length > 0) {
    lines.push(
      "4. ADJUDICATE each failing spec below \u2014 read its source, reproduce against the live app:",
      specLines(adjudicate),
      '   Verdict "regression": the old behavior should still work and this run broke it.',
      '   Verdict "intentional-change": a task above deliberately changed this behavior \u2014 you MUST include a `citation` quoting the authorizing task/criterion language verbatim; an uncited intentional-change verdict is rejected.'
    );
  }
  if (update.length > 0 || adjudicate.length > 0) {
    lines.push(
      `${adjudicate.length > 0 ? "5" : "4"}. UPDATE these pre-authorized specs${adjudicate.length > 0 ? " plus every spec you ruled intentional-change" : ""} \u2014 rewrite each to assert the NEW behavior, keep its "${CONTROL_TITLE_PREFIX}"-titled assertion, validate it green against the live staging app, and COMMIT it in this worktree:`,
      ...update.length > 0 ? [specLines(update)] : []
    );
  }
  lines.push(
    "Only the spec files listed above may change \u2014 touching anything else fails the run. Do NOT push.",
    'Finish with your terminal STATUS line and return {"status": "<line>", "verdicts": [...]} \u2014 one {spec_path, verdict, reason, citation?} row per ADJUDICATED spec only (pre-authorized updates need no verdict row); `reason` is plain language a non-technical reader understands.'
  );
  return lines.join("\n");
}
async function prepareAdjudicatorSpawn(deps, run9, runId, boot) {
  const cursor = run9.e2e_phase?.adjudication;
  if (cursor === void 0) {
    throw new Error(`run '${runId}': prepareAdjudicatorSpawn called with no adjudication cursor`);
  }
  const staging = run9.staging_branch;
  const branch = adjudicateBranchName(runId);
  const worktree = e2eAdjudicateWorktreePath(deps.workDir, runId);
  await deps.git.fetch("origin", staging);
  await ensureStageWorktree(deps.git, {
    worktree,
    ref: `origin/${staging}`,
    branch,
    resetIfExists: cursor.attempts >= 1,
    provision: () => (deps.provision ?? provisionWorktree)({
      path: worktree,
      setupCommand: deps.config.quality.setupCommand
    })
  });
  return {
    kind: "spawn",
    expects: "adjudication-results",
    run_id: runId,
    agent_type: E2E_AUTHOR_AGENT_TYPE,
    worktree,
    staging_branch: staging,
    adjudicate_branch: branch,
    model: E2E_AUTHOR_MODEL,
    prompt: buildAdjudicationPrompt({ worktree, boot, cursor, spec: deps.spec })
  };
}
async function failAdjudication(deps, runId, worktree, reason) {
  await removeWorktreeBestEffort(deps.git, worktree);
  await deps.state.update(
    runId,
    (s) => s.e2e_phase === void 0 ? s : { ...s, e2e_phase: { ...s.e2e_phase, adjudication: void 0 } }
  );
  await markFailed(deps, runId, reason);
  return { kind: "failed", run_id: runId, reason };
}
async function retryAdjudicatorOrFail(deps, runId, worktree, reason, emit2) {
  const run9 = await deps.state.read(runId);
  const cursor = run9.e2e_phase?.adjudication;
  const attempts = (cursor?.attempts ?? 0) + 1;
  if (attempts >= MAX_AUTHOR_ATTEMPTS) {
    return failAdjudication(deps, runId, worktree, `${reason} (after ${attempts} attempts)`);
  }
  await deps.state.update(
    runId,
    (s) => s.e2e_phase?.adjudication === void 0 ? s : {
      ...s,
      e2e_phase: {
        ...s.e2e_phase,
        adjudication: { ...s.e2e_phase.adjudication, attempts }
      }
    }
  );
  log29.warn(
    `run '${runId}': e2e-adjudicator attempt ${attempts}/${MAX_AUTHOR_ATTEMPTS} failed \u2014 re-spawning (${reason})`
  );
  return emit2(deps, runId);
}
async function recordAdjudication(deps, runId, run9, results, emit2) {
  const worktree = e2eAdjudicateWorktreePath(deps.workDir, runId);
  const phase = nonNull(run9.e2e_phase);
  const cursor = nonNull(phase.adjudication);
  const outcome = parseProducerStatus(results.status);
  if (outcome.status === "error") {
    return retryAdjudicatorOrFail(deps, runId, worktree, `e2e-adjudicator: ${outcome.reason}`, emit2);
  }
  if (outcome.status !== "done") {
    const reason = `e2e-adjudicator: ${"reason" in outcome ? outcome.reason : "no parseable status"}`;
    return failAdjudication(deps, runId, worktree, reason);
  }
  const verdicts = results.verdicts ?? [];
  const cursorPaths = new Set(cursor.specs.map((s) => s.spec_path));
  const ruled = new Set(verdicts.map((v) => v.spec_path));
  const unruled = cursor.specs.filter((s) => s.mode === "adjudicate" && !ruled.has(s.spec_path));
  const unknown = verdicts.filter((v) => !cursorPaths.has(v.spec_path));
  const uncited = verdicts.filter(
    (v) => v.verdict === "intentional-change" && (v.citation === void 0 || v.citation === "")
  );
  if (unruled.length > 0 || unknown.length > 0 || uncited.length > 0) {
    const parts = [
      ...unruled.length > 0 ? [`missing verdict(s) for: ${unruled.map((s) => s.spec_path).join(", ")}`] : [],
      ...unknown.length > 0 ? [`verdict(s) for spec(s) not under adjudication: ${unknown.map((v) => v.spec_path).join(", ")}`] : [],
      ...uncited.length > 0 ? [
        `intentional-change verdict(s) missing the required citation: ${uncited.map((v) => v.spec_path).join(", ")}`
      ] : []
    ];
    return retryAdjudicatorOrFail(deps, runId, worktree, `e2e-adjudicator: ${parts.join("; ")}`, emit2);
  }
  const regressions2 = verdicts.filter((v) => v.verdict === "regression");
  if (regressions2.length > 0) {
    const reason = "e2e adjudication: regression verdict \u2014 " + regressions2.map((v) => `${v.spec_path}: ${v.reason}`).join("; ");
    return failAdjudication(deps, runId, worktree, reason);
  }
  const staging = run9.staging_branch;
  const changed = await deps.git.diffNames(staging, adjudicateBranchName(runId), {
    cwd: worktree
  });
  const stray = changed.filter((f) => !cursorPaths.has(f));
  if (stray.length > 0) {
    const reason = `e2e-adjudicator: branch touches path(s) outside the adjudicated spec set \u2014 refusing to merge unreviewed changes: ${stray.join(", ")}`;
    return failAdjudication(deps, runId, worktree, reason);
  }
  const unrewritten = cursor.specs.filter((s) => !changed.includes(s.spec_path));
  if (unrewritten.length > 0) {
    return retryAdjudicatorOrFail(
      deps,
      runId,
      worktree,
      `e2e-adjudicator: spec(s) not rewritten: ${unrewritten.map((s) => s.spec_path).join(", ")}`,
      emit2
    );
  }
  const boot = resolveBootConfig(deps.config.e2e, run9);
  if (boot === null) {
    return failAdjudication(
      deps,
      runId,
      worktree,
      "e2e-adjudicator: boot config vanished between spawn and record (config or assessment state changed mid-run)"
    );
  }
  const proof = await proveCriticals(
    deps,
    runId,
    changed.map((f) => ({ task_ids: [], spec_path: f, kind: "critical" })),
    worktree,
    boot
  );
  if (!proof.ok) {
    return failAdjudication(deps, runId, worktree, `e2e adjudication re-proof: ${proof.reason}`);
  }
  await publishToStaging(deps.git, staging, adjudicateBranchName(runId));
  await removeWorktreeBestEffort(deps.git, worktree);
  await deps.state.update(runId, (s) => {
    if (s.e2e_phase === void 0) {
      return s;
    }
    const counts = { ...s.e2e_phase.adjudication_counts ?? {} };
    for (const spec of cursor.specs) {
      counts[spec.spec_path] = (counts[spec.spec_path] ?? 0) + 1;
    }
    return {
      ...s,
      e2e_phase: { ...s.e2e_phase, adjudication: void 0, adjudication_counts: counts }
    };
  });
  log29.info(`run '${runId}': e2e adjudication merged ${cursor.specs.length} updated spec(s) \u2014 re-running the suite`);
  return runSuiteAndDecide(deps, runId);
}
function throwawayConfigPath(worktree) {
  return join21(worktree, ".factory-e2e-throwaway.config.cjs");
}
function throwawayConfigContents(throwawayDir) {
  return [
    "// Generated by the factory e2e coroutine \u2014 never commit, rewritten every run.",
    'const { defineConfig } = require("@playwright/test");',
    "module.exports = defineConfig({",
    `  testDir: ${JSON.stringify(throwawayDir)},`,
    "  use: { baseURL: process.env.BASE_URL },",
    "  webServer: {",
    "    command: process.env.FACTORY_E2E_START_COMMAND,",
    "    url: process.env.BASE_URL,",
    "    reuseExistingServer: process.env.FACTORY_E2E ? false : true,",
    "    timeout: Number(process.env.FACTORY_E2E_READY_TIMEOUT_MS) || 30_000,",
    "  },",
    "});",
    ""
  ].join("\n");
}
async function runSuiteAndDecide(deps, runId) {
  const run9 = await deps.state.read(runId);
  const manifest = run9.e2e_phase?.manifest ?? [];
  const attempts = (run9.e2e_phase?.attempts ?? 0) + 1;
  const firstPass = attempts === 1;
  const cfg = deps.config.e2e;
  const failPhase = async (reason) => {
    await markFailed(deps, runId, reason, attempts);
    return { kind: "failed", run_id: runId, reason };
  };
  if (manifest.length === 0) {
    await markDone(deps, runId, { attempts });
    return { kind: "done", run_id: runId };
  }
  const boot = resolveBootConfig(cfg, run9);
  if (boot === null) {
    return failPhase("e2e suite has no boot config \u2014 the run-start assessment resolved none and no override is set");
  }
  const staging = run9.staging_branch;
  const worktree = e2eRunWorktreePath(deps.workDir, runId);
  const provision = deps.provision ?? provisionWorktree;
  await deps.git.fetch("origin", staging);
  await ensureStageWorktree(deps.git, {
    worktree,
    ref: `origin/${staging}`,
    branch: `e2e-run-${runId}`,
    resetIfExists: true
  });
  await provision({ path: worktree, setupCommand: deps.config.quality.setupCommand });
  const tool = deps.playwright ?? new DefaultPlaywrightTool();
  let criticalResult;
  try {
    criticalResult = await runE2e(
      { cwd: worktree, env: scrubbedE2eEnv(cfg, boot), replaceEnv: true, testDir: E2E_TEST_DIR },
      tool
    );
  } catch (err) {
    return failPhase(`e2e critical suite tooling error: ${errText(err)}`);
  }
  const throwaway = manifest.filter((e) => e.kind === "throwaway");
  let throwawayResult;
  let throwawayThrew;
  if (throwaway.length > 0) {
    const throwawayDir = e2eThrowawayDir(deps.workDir, runId);
    const configPath2 = throwawayConfigPath(worktree);
    await (deps.files ?? new DefaultE2eFileOps()).writeConfig(configPath2, throwawayConfigContents(throwawayDir));
    try {
      throwawayResult = await runE2e(
        { cwd: worktree, env: scrubbedE2eEnv(cfg, boot), replaceEnv: true, config: configPath2 },
        tool
      );
    } catch (err) {
      if (firstPass) {
        return failPhase(`e2e throwaway suite tooling error: ${errText(err)}`);
      }
      throwawayThrew = errText(err);
    }
  }
  const criticalEntries = manifest.filter((e) => e.kind === "critical");
  const criticalMisses = criticalEntries.map((entry) => ({
    entry,
    spec: criticalResult.specs.find((s) => specPathMatches(s.file, entry.spec_path))
  })).filter((m) => m.spec === void 0 || m.spec.status !== "passed" && m.spec.status !== "flaky");
  if (unattributableToolingFailure(criticalResult)) {
    return failPhase(
      "e2e critical suite reported a tooling failure (nonzero exit code or reporter errors[]) with no individual spec marked failed \u2014 refusing to attribute to a task"
    );
  }
  if (firstPass && throwawayResult && unattributableToolingFailure(throwawayResult)) {
    return failPhase(
      "e2e throwaway suite reported a tooling failure (nonzero exit code or reporter errors[]) with no individual spec marked failed \u2014 refusing to attribute to a task"
    );
  }
  const criticalSpecFailures = criticalResult.specs.filter((s) => s.status === "failed");
  const throwawayFailed = throwawayResult?.specs.filter((s) => s.status === "failed") ?? [];
  const unmappableCritical = criticalSpecFailures.filter((s) => findEntry(manifest, s) === void 0);
  const stillPass = [];
  if (unmappableCritical.length > 0) {
    const affected = run9.e2e_assessment?.affected_specs ?? [];
    const counts = run9.e2e_phase?.adjudication_counts ?? {};
    const readjudicated = [];
    const cursorSpecs = [];
    for (const s of unmappableCritical) {
      const row = affected.find((r) => specPathMatches(s.file, r.spec_path));
      const specPath = row?.spec_path ?? (s.file.startsWith(`${E2E_TEST_DIR}/`) ? s.file : `${E2E_TEST_DIR}/${s.file}`);
      if ((counts[specPath] ?? 0) >= 1) {
        readjudicated.push(specPath);
      } else if (row?.expectation === "should-still-pass") {
        stillPass.push({
          spec: s,
          entry: { task_ids: [...row.task_ids], spec_path: row.spec_path, kind: "critical" }
        });
      } else {
        cursorSpecs.push({
          spec_path: specPath,
          title: s.title,
          ...s.error !== void 0 ? { error: s.error } : {},
          mode: row?.expectation === "needs-update" ? "update" : "adjudicate"
        });
      }
    }
    if (readjudicated.length > 0) {
      return failPhase(
        `pre-existing e2e spec(s) failing AGAIN after their one adjudication \u2014 treating as a regression: ${readjudicated.join(", ")}`
      );
    }
    if (cursorSpecs.length > 0) {
      await deps.state.update(runId, (st) => ({
        ...st,
        e2e_phase: {
          ...st.e2e_phase ?? defaultE2ePhase(),
          adjudication: { specs: cursorSpecs, attempts: 0, requested_at: nowIso() }
        }
      }));
      log29.info(`run '${runId}': ${cursorSpecs.length} pre-existing failing spec(s) sent to adjudication`);
      return prepareAdjudicatorSpawn(deps, await deps.state.read(runId), runId, boot);
    }
  }
  const throwawayCandidates = firstPass ? throwawayFailed.map((spec) => ({ spec, entry: findEntry(manifest, spec) })).filter((m) => m.entry !== void 0) : [];
  const mappable = [
    ...criticalMisses,
    ...throwawayCandidates,
    ...stillPass
  ];
  if (mappable.length === 0) {
    const throwawayToolingFailed = !firstPass && (throwawayThrew !== void 0 || throwawayResult !== void 0 && unattributableToolingFailure(throwawayResult));
    const advisory = throwawayFailed.length > 0 ? `${throwawayFailed.length} throwaway spec(s) still red (non-gating): ` + throwawayFailed.map((s) => s.title).join(", ") : throwawayToolingFailed ? "throwaway suite reported a tooling failure (non-gating)" : void 0;
    await markDone(deps, runId, { attempts, advisory });
    return { kind: "done", run_id: runId };
  }
  const taskIds = [...new Set(mappable.flatMap((m) => m.entry.task_ids))];
  const reopenCounts = { ...run9.e2e_phase?.reopen_counts ?? {} };
  const capExhausted = taskIds.filter((id) => (reopenCounts[id] ?? 0) >= cfg.reopenCap);
  if (capExhausted.length > 0) {
    return failPhase(`e2e reopen cap (${cfg.reopenCap}) exhausted for task(s): ${capExhausted.join(", ")}`);
  }
  const feedback = "The e2e phase found these journeys still failing:\n" + mappable.map((m) => {
    const title = m.spec ? m.spec.title : "did not run (missing from results)";
    const detail = m.spec?.error != null && m.spec.error.length > 0 ? `
  ${m.spec.error.replace(/\n/g, "\n  ")}` : "";
    return `- ${m.entry.spec_path} \u2014 "${title}"${detail}`;
  }).join("\n");
  for (const id of taskIds) {
    reopenCounts[id] = (reopenCounts[id] ?? 0) + 1;
  }
  await deps.state.update(runId, (s) => ({
    ...s,
    tasks: Object.fromEntries(
      Object.entries(s.tasks).map(
        ([id, t]) => taskIds.includes(id) ? [id, resetTaskRow(t, { e2eFeedback: feedback, clearShippedPr: true })] : [id, t]
      )
    ),
    e2e_phase: {
      ...s.e2e_phase ?? defaultE2ePhase(),
      status: void 0,
      reason: void 0,
      advisory: void 0,
      attempts,
      manifest,
      // already `run.e2e_phase?.manifest` (read at the top of this function) — s.e2e_phase can't have diverged since
      reopen_counts: reopenCounts
    }
  }));
  log29.info(`run '${runId}': e2e reopening task(s) ${taskIds.join(", ")} (pass ${attempts})`);
  return { kind: "reopen", run_id: runId, task_ids: taskIds, reason: feedback };
}

// src/orchestrator/e2e-author.ts
var log30 = createLogger("e2e");
function buildAuthorPrompt(args) {
  const taskLines = specTaskLines(args.spec);
  return [
    "You are the factory e2e-author running the pipeline's end-to-end test-authoring phase.",
    `1. cd into your worktree: ${args.worktree} (checked out on the e2e branch off the staging tip).`,
    `2. Boot the app: \`${args.startCommand}\` \u2192 ${args.baseURL} (reuse if already running).`,
    "3. Review every task this PRD delivered:",
    taskLines,
    `4. For each USER-FACING task, explore the live app via the Playwright MCP tools and author a THROWAWAY spec into ${args.throwawayDir} (OUTSIDE this worktree \u2014 never commit it).`,
    `5. Author a small number of CRITICAL, money-path JOURNEY specs (thin \u2014 the load-bearing net, not per-task coverage) into ${args.worktree}/${args.testDir}/ and COMMIT them in this worktree. Each critical spec MUST include one assertion titled with the "${CONTROL_TITLE_PREFIX}" prefix that passes on ANY boot of the app (e.g. the page loads) \u2014 the fail-first proof uses it to tell 'the app didn't boot' apart from 'the feature doesn't exist yet.'`,
    "6. Self-validate: every spec you authored must be green against the live (staging) app before you finish.",
    "7. Do NOT push (the engine merges the critical specs on record). Do NOT edit non-e2e files.",
    'Finish with your terminal STATUS line and return {"status": "<line>", "manifest": [...]} \u2014 the manifest is an array of {task_ids, spec_path, kind, title} rows, one per spec you authored (critical `spec_path` is worktree-relative; throwaway `spec_path` is throwaway-dir-relative; `title` is a plain-language journey name a non-technical reader understands, e.g. "Sign up and reach the dashboard"). EVERY file you commit under the test dir must appear as a critical manifest row (support helpers under support/ and auth.setup.ts excepted) \u2014 an undeclared committed spec is rejected at record. Per agents/e2e-author.md + skills/e2e-authoring/SKILL.md for the full authoring discipline.'
  ].join("\n");
}
async function prepareAuthorSpawn(deps, run9, runId, boot, testDir) {
  const staging = run9.staging_branch;
  const base = deps.config.git.baseBranch;
  const branch = e2eBranchName(runId);
  const worktree = e2eWorktreePath(deps.workDir, runId);
  const baseRef = `origin/${base}`;
  await deps.git.fetch("origin", staging);
  await ensureStageWorktree(deps.git, {
    worktree,
    ref: `origin/${staging}`,
    branch,
    resetIfExists: (run9.e2e_phase?.author_attempts ?? 0) >= 1,
    provision: () => (deps.provision ?? provisionWorktree)({
      path: worktree,
      setupCommand: deps.config.quality.setupCommand
    })
  });
  const throwawayDir = e2eThrowawayDir(deps.workDir, runId);
  return {
    kind: "spawn",
    expects: "author-results",
    run_id: runId,
    agent_type: E2E_AUTHOR_AGENT_TYPE,
    worktree,
    base_ref: baseRef,
    staging_branch: staging,
    e2e_branch: branch,
    throwaway_dir: throwawayDir,
    model: E2E_AUTHOR_MODEL,
    prompt: buildAuthorPrompt({
      worktree,
      baseRef,
      throwawayDir,
      testDir,
      startCommand: boot.startCommand,
      baseURL: boot.baseURL,
      spec: deps.spec
    })
  };
}
function assertSafeSpecPath(specPath) {
  if (isAbsolute2(specPath)) {
    throw new Error(`e2e manifest spec_path '${specPath}' must be relative, not absolute`);
  }
  if (specPath.split(/[\\/]+/).includes("..")) {
    throw new Error(`e2e manifest spec_path '${specPath}' must not contain '..' segments`);
  }
}
async function failWithCleanup(deps, runId, worktree, reason) {
  await removeWorktreeBestEffort(deps.git, worktree);
  await markFailed(deps, runId, reason);
  return { kind: "failed", run_id: runId, reason };
}
async function retryAuthorOrFail(deps, runId, worktree, reason, emit2) {
  const run9 = await deps.state.read(runId);
  const attempts = (run9.e2e_phase?.author_attempts ?? 0) + 1;
  if (attempts >= MAX_AUTHOR_ATTEMPTS) {
    return failWithCleanup(deps, runId, worktree, `${reason} (after ${attempts} attempts)`);
  }
  await deps.state.update(runId, (s) => ({
    ...s,
    e2e_phase: {
      ...s.e2e_phase ?? defaultE2ePhase(),
      author_attempts: attempts
    }
  }));
  log30.warn(`run '${runId}': e2e-author attempt ${attempts}/${MAX_AUTHOR_ATTEMPTS} crashed \u2014 re-spawning (${reason})`);
  return emit2(deps, runId);
}
async function recordAuthorResults(deps, runId, results, emit2) {
  const worktree = e2eWorktreePath(deps.workDir, runId);
  const outcome = parseProducerStatus(results.status);
  if (outcome.status === "error") {
    return retryAuthorOrFail(deps, runId, worktree, `e2e-author: ${outcome.reason}`, emit2);
  }
  if (outcome.status !== "done") {
    const reason = `e2e-author: ${"reason" in outcome ? outcome.reason : "no parseable status"}`;
    return failWithCleanup(deps, runId, worktree, reason);
  }
  if (results.manifest.length === 0 && results.no_ui_surface !== true) {
    const reason = "e2e-author: STATUS: DONE with an empty manifest but no_ui_surface was not explicitly true \u2014 ambiguous (genuine no-op vs. a malformed/incomplete response); refusing to silently pass";
    return failWithCleanup(deps, runId, worktree, reason);
  }
  for (const entry of results.manifest) {
    try {
      assertSafeSpecPath(entry.spec_path);
    } catch (err) {
      return failWithCleanup(deps, runId, worktree, `e2e-author: ${errText(err)}`);
    }
  }
  const cfg = deps.config.e2e;
  const run9 = await deps.state.read(runId);
  const staging = run9.staging_branch;
  const critical = results.manifest.filter((e) => e.kind === "critical");
  const unknownTaskIds = [...new Set(results.manifest.flatMap((e) => e.task_ids))].filter((id) => !(id in run9.tasks));
  if (unknownTaskIds.length > 0) {
    const reason = `e2e-author: manifest references unknown task_id(s) not in this run: ` + unknownTaskIds.join(", ");
    return failWithCleanup(deps, runId, worktree, reason);
  }
  if (critical.length > 0) {
    const testDirPrefix = `${E2E_TEST_DIR}/`;
    const outsideTestDir = critical.filter((e) => !e.spec_path.startsWith(testDirPrefix));
    if (outsideTestDir.length > 0) {
      const reason = `e2e-author: critical spec_path(s) not under '${testDirPrefix}' \u2014 refusing to merge: ` + outsideTestDir.map((e) => e.spec_path).join(", ");
      return failWithCleanup(deps, runId, worktree, reason);
    }
    const branch = e2eBranchName(runId);
    const changed = await deps.git.diffNames(staging, branch, { cwd: worktree });
    const stray = changed.filter((f) => !f.startsWith(testDirPrefix));
    if (stray.length > 0) {
      const reason = `e2e-author: branch touches path(s) outside '${testDirPrefix}' \u2014 refusing to merge unreviewed changes: ${stray.join(", ")}`;
      return failWithCleanup(deps, runId, worktree, reason);
    }
    const declared = new Set(critical.map((e) => e.spec_path));
    const undeclared = changed.filter(
      (f) => !declared.has(f) && !f.startsWith(`${testDirPrefix}support/`) && f !== `${testDirPrefix}auth.setup.ts`
    );
    if (undeclared.length > 0) {
      const reason = `e2e-author: committed file(s) under '${testDirPrefix}' missing from the manifest \u2014 an undeclared spec can never be joined back to a task, refusing to merge: ` + undeclared.join(", ");
      return failWithCleanup(deps, runId, worktree, reason);
    }
    const boot = resolveBootConfig(cfg, run9);
    if (boot === null) {
      return failWithCleanup(
        deps,
        runId,
        worktree,
        "e2e-author: boot config vanished between spawn and record (config or assessment state changed mid-run)"
      );
    }
    const proof = await proveCriticals(deps, runId, critical, worktree, boot);
    if (!proof.ok) {
      return failWithCleanup(deps, runId, worktree, proof.reason);
    }
    await publishToStaging(deps.git, staging, e2eBranchName(runId));
  }
  await removeWorktreeBestEffort(deps.git, worktree);
  await deps.state.update(runId, (s) => ({
    ...s,
    e2e_phase: {
      ...s.e2e_phase ?? defaultE2ePhase(),
      manifest: results.manifest
    }
  }));
  return runSuiteAndDecide(deps, runId);
}

// src/orchestrator/e2e.ts
var log31 = createLogger("e2e");
async function runE2eEmit(deps, runId) {
  const run9 = await deps.state.read(runId);
  const cfg = deps.config.e2e;
  const boot = resolveBootConfig(cfg, run9);
  if (boot === null) {
    const reason = "e2e phase has no boot config \u2014 the run-start assessment resolved none and no override is set; run `factory configure --set e2e.startCommand=<cmd> --set e2e.baseURL=<url>` then resume";
    await deps.state.update(runId, (s) => ({ ...s, status: "suspended" }));
    log31.warn(`run '${runId}': ${reason}`);
    return { kind: "suspend", run_id: runId, reason };
  }
  if (run9.e2e_phase === void 0) {
    return prepareAuthorSpawn(deps, run9, runId, boot, E2E_TEST_DIR);
  }
  if (run9.e2e_phase.status === void 0 && run9.e2e_phase.manifest.length === 0 && (run9.e2e_phase.author_attempts ?? 0) >= 1) {
    return prepareAuthorSpawn(deps, run9, runId, boot, E2E_TEST_DIR);
  }
  if (run9.e2e_phase.status === void 0 && run9.e2e_phase.adjudication !== void 0) {
    return prepareAdjudicatorSpawn(deps, run9, runId, boot);
  }
  return runSuiteAndDecide(deps, runId);
}
async function runE2eRecord(deps, runId, results) {
  const run0 = await deps.state.read(runId);
  if (run0.e2e_phase?.adjudication !== void 0) {
    return recordAdjudication(deps, runId, run0, results, runE2eEmit);
  }
  return recordAuthorResults(deps, runId, results, runE2eEmit);
}

// src/orchestrator/assessment.ts
import { join as join22 } from "node:path";
var log32 = createLogger("e2e-assess");
var ASSESSOR_MODEL = "sonnet";
var MAX_ASSESS_ATTEMPTS = 2;
function assessmentWorktreePath(workDir, runId) {
  return join22(workDir, runId, ".e2e-assess");
}
function assessBranchName(runId) {
  return `e2e-assess-${runId}`;
}
var AssessmentResultsSchema = external_exports.object({
  status: external_exports.enum(["ok", "degraded", "boot-impossible", "machinery-impossible", "error"]),
  /** Plain-language explanation — REQUIRED in practice for every non-`ok` status. */
  reason: external_exports.string().optional(),
  /** Degraded-coverage note (auth-only gap) — surfaces in the author prompt + report. */
  warning: external_exports.string().optional(),
  /** Boot config the assessor resolved + wrote into `playwright.config.ts`. */
  resolved: external_exports.object({
    start_command: external_exports.string().min(1).optional(),
    base_url: external_exports.string().min(1).optional()
  }).optional(),
  affected_specs: external_exports.array(E2eAffectedSpecSchema).default([])
}).strict();
function buildAssessorPrompt(args) {
  const taskLines = specTaskLines(args.spec);
  const hasOverride = args.cfg.startCommand != null && args.cfg.startCommand.length > 0 || args.cfg.baseURL != null && args.cfg.baseURL.length > 0;
  const overrides = hasOverride ? `Operator config overrides exist \u2014 treat them as authoritative: startCommand=${args.cfg.startCommand ?? "(unset)"}, baseURL=${args.cfg.baseURL ?? "(unset)"}.` : "No operator overrides \u2014 resolve the boot config yourself.";
  return [
    "You are the factory e2e-assessor running the pipeline's run-start assessment phase (Decision 40).",
    `1. cd into your worktree: ${args.worktree} (checked out on the assessment branch off the staging tip).`,
    `2. MACHINERY CHECK \u2014 inspect playwright.config.ts and ${args.testDir}/ (support/, auth.setup.ts).`,
    `   ${overrides}`,
    "   - If playwright.config.ts still carries scaffold TODO/fallback values, determine the app's REAL start command + base URL (package.json scripts, framework defaults) and write them in.",
    `   - If exercising the app needs seed data or a login, author the machinery: ${args.testDir}/support/seed.ts and/or ${args.testDir}/auth.setup.ts.`,
    "   - VALIDATE: boot the app with the resolved start command and, if auth machinery exists or was authored, prove a login works via the Playwright MCP tools.",
    "   - STEADY STATE: if config + machinery are already real (no TODOs) from a prior run, change NOTHING and skip the boot \u2014 this pass is read-only.",
    "3. COVERAGE FORECAST \u2014 this run will deliver these tasks:",
    taskLines,
    `   For each COMMITTED spec under ${args.testDir}/ whose asserted behavior a task above will touch, emit an affected_specs row {"spec_path", "task_ids", "expectation"}: "needs-update" when the task INTENTIONALLY changes what the spec asserts, "should-still-pass" when the spec must survive the change. Leave untouched specs out.`,
    `4. COMMIT anything you changed IN this worktree. Only files under ${args.testDir}/ plus playwright.config.ts are accepted \u2014 anything else is rejected at record. Do NOT push.`,
    "5. Return your verdict as structured output {status, reason?, warning?, resolved?, affected_specs}:",
    '   - "ok" \u2014 machinery ready (validated or steady-state).',
    '   - "degraded" \u2014 the app boots but auth/seed coverage cannot be made to work; set `warning` naming exactly what coverage is lost, in plain language.',
    '   - "boot-impossible" \u2014 the app cannot be booted here (missing services, no seedable DB, ...); set `reason` in plain language a non-technical reader understands: what you tried, why it cannot work, and what the user could do about it.',
    '   - "machinery-impossible" \u2014 the app boots but no meaningful e2e coverage is achievable; plain-language `reason` as above.',
    "   ALWAYS set resolved {start_command, base_url} on ok/degraded \u2014 even steady-state, where you read the values out of playwright.config.ts instead of booting. The engine's e2e phase boots the app from `resolved`; omitting it strands the run without a boot config.",
    "Per agents/e2e-assessor.md for the full discipline."
  ].join("\n");
}
async function runAssessmentEmit(deps, runId) {
  const run9 = await deps.state.read(runId);
  if (run9.e2e_assessment?.status === "done") {
    const warning = run9.e2e_assessment.warning;
    return { kind: "done", run_id: runId, ...warning !== void 0 ? { warning } : {} };
  }
  if (run9.e2e_assessment?.status === "failed") {
    return {
      kind: "failed",
      run_id: runId,
      reason: run9.e2e_assessment.reason ?? "e2e assessment failed"
    };
  }
  const staging = run9.staging_branch;
  const branch = assessBranchName(runId);
  const worktree = assessmentWorktreePath(deps.workDir, runId);
  await deps.git.fetch("origin", staging);
  await ensureStageWorktree(deps.git, {
    worktree,
    ref: `origin/${staging}`,
    branch,
    resetIfExists: (run9.e2e_assessment?.attempts ?? 0) >= 1,
    provision: () => (deps.provision ?? provisionWorktree)({
      path: worktree,
      setupCommand: deps.config.quality.setupCommand
    })
  });
  return {
    kind: "spawn",
    run_id: runId,
    agent_type: E2E_ASSESSOR_AGENT_TYPE,
    worktree,
    staging_branch: staging,
    assess_branch: branch,
    model: ASSESSOR_MODEL,
    prompt: buildAssessorPrompt({
      worktree,
      testDir: E2E_TEST_DIR,
      spec: deps.spec,
      cfg: deps.config.e2e
    })
  };
}
function defaultAssessment() {
  return { affected_specs: [] };
}
async function failAssessment(deps, runId, reason, attempts) {
  const worktree = assessmentWorktreePath(deps.workDir, runId);
  await removeWorktreeBestEffort(deps.git, worktree);
  const run9 = await deps.state.read(runId);
  const open2 = Object.values(run9.tasks).filter((t) => !isTerminalTaskStatus(t.status));
  for (const t of open2) {
    await failTask(
      { state: deps.state },
      runId,
      t.task_id,
      "blocked-environmental",
      `e2e assessment failed: ${reason}`
    );
  }
  await deps.state.update(runId, (s) => ({
    ...s,
    e2e_assessment: {
      ...s.e2e_assessment ?? defaultAssessment(),
      status: "failed",
      reason,
      warning: void 0,
      attempts,
      ended_at: nowIso()
    }
  }));
  log32.warn(`run '${runId}': e2e assessment failed \u2014 ${reason}`);
  return { kind: "failed", run_id: runId, reason };
}
async function retryOrFail(deps, runId, reason, attempts) {
  if (attempts >= MAX_ASSESS_ATTEMPTS) {
    return failAssessment(deps, runId, `${reason} (after ${attempts} attempts)`, attempts);
  }
  await deps.state.update(runId, (s) => ({
    ...s,
    e2e_assessment: { ...s.e2e_assessment ?? defaultAssessment(), attempts }
  }));
  log32.warn(`run '${runId}': e2e assessment attempt ${attempts} failed (${reason}) \u2014 retrying`);
  return runAssessmentEmit(deps, runId);
}
async function runAssessmentRecord(deps, runId, results) {
  const worktree = assessmentWorktreePath(deps.workDir, runId);
  const run9 = await deps.state.read(runId);
  const attempts = (run9.e2e_assessment?.attempts ?? 0) + 1;
  if (results.status === "boot-impossible" || results.status === "machinery-impossible") {
    const reason = results.reason ?? (results.status === "boot-impossible" ? "the app cannot be booted for e2e testing (assessor gave no detail)" : "no meaningful e2e coverage is achievable in this repo (assessor gave no detail)");
    return failAssessment(deps, runId, reason, attempts);
  }
  if (results.status === "error") {
    return retryOrFail(deps, runId, results.reason ?? "assessor crashed or was skipped", attempts);
  }
  const unknownTaskIds = [...new Set(results.affected_specs.flatMap((e) => e.task_ids))].filter(
    (id) => !(id in run9.tasks)
  );
  if (unknownTaskIds.length > 0) {
    return retryOrFail(
      deps,
      runId,
      `assessor forecast references unknown task_id(s): ${unknownTaskIds.join(", ")}`,
      attempts
    );
  }
  const staging = run9.staging_branch;
  const testDirPrefix = `${E2E_TEST_DIR}/`;
  const changed = await deps.git.diffNames(staging, assessBranchName(runId), { cwd: worktree });
  const stray = changed.filter((f) => !f.startsWith(testDirPrefix) && f !== "playwright.config.ts");
  if (stray.length > 0) {
    return retryOrFail(
      deps,
      runId,
      `assessor branch touches path(s) outside '${testDirPrefix}' + playwright.config.ts \u2014 refusing to merge unreviewed changes: ${stray.join(", ")}`,
      attempts
    );
  }
  if (changed.length > 0) {
    await publishToStaging(deps.git, staging, assessBranchName(runId));
  }
  await removeWorktreeBestEffort(deps.git, worktree);
  const warning = results.status === "degraded" ? results.warning ?? results.reason ?? "e2e assessment degraded (assessor gave no detail)" : void 0;
  await deps.state.update(runId, (s) => ({
    ...s,
    e2e_assessment: {
      status: "done",
      reason: void 0,
      warning,
      resolved: results.resolved,
      affected_specs: results.affected_specs,
      attempts,
      ended_at: nowIso()
    }
  }));
  const doneMsg = `run '${runId}': e2e assessment done (${results.status}, ${results.affected_specs.length} affected spec(s)${warning !== void 0 ? `, warning: ${warning}` : ""})`;
  if (results.status === "degraded") {
    log32.warn(doneMsg);
  } else {
    log32.info(doneMsg);
  }
  return { kind: "done", run_id: runId, ...warning !== void 0 ? { warning } : {} };
}

// src/orchestrator/lifecycle.ts
var log33 = createLogger("run");
async function seedFromLedger(specStore, request, seeded, stagingDeps, stagingTip) {
  const latest = latestByTask(await specStore.ledger(request.repo, request.spec_id));
  if (latest.size === 0) {
    return;
  }
  const git = stagingDeps.gitClient;
  const cwd = stagingDeps.targetRoot;
  const isAncestor = async (sha) => {
    try {
      const resolved = await git.revParse(sha, { cwd });
      return await git.mergeBase(resolved, stagingTip, { cwd }) === resolved;
    } catch {
      return false;
    }
  };
  const shippedIds = [];
  for (const [taskId, entry] of latest) {
    const row = seeded[taskId];
    if (row === void 0) {
      continue;
    }
    const checks = await Promise.all(entry.shas.map(isAncestor));
    if (checks.every(Boolean)) {
      seeded[taskId] = { ...row, status: "done", ended_at: nowIso() };
      shippedIds.push(taskId);
    }
  }
  if (shippedIds.length > 0) {
    log33.info(
      `run create: seeded ${shippedIds.length} task(s) as already-shipped from ledger (${shippedIds.join(", ")})`
    );
  }
}
function seedTasksFromSpec(request) {
  const ctx = { context: "run create", specLabel: `spec ${request.spec_id}` };
  const tasks = seedTaskRows(request.tasks, ctx);
  assertAcyclic(tasks, ctx);
  return tasks;
}
async function resolveSpec2(specStore, opts) {
  const request = opts.specId !== void 0 ? await specStore.read(opts.repo, opts.specId) : await specStore.resolveByIssue(opts.repo, opts.issue);
  if (request === null) {
    throw new Error(`run create: no spec for issue #${opts.issue} in ${opts.repo} \u2014 generate one first`);
  }
  if (!await specStore.hasPrd(request.repo, request.spec_id)) {
    throw new Error(
      `run create: spec ${request.spec_id} has no PRD snapshot (created by an older factory version) \u2014 re-run with \`--supersede\` to regenerate the spec`
    );
  }
  return request;
}
async function createRunFromManifest(state, specStore, request, opts, stagingDeps) {
  const seeded = seedTasksFromSpec(request);
  const branch = runStagingBranch(opts.runId);
  if (state.exists(opts.runId)) {
    throw new Error(`state: run '${opts.runId}' already exists`);
  }
  if (stagingDeps !== void 0) {
    const staging = await ensureStaging({
      gitClient: stagingDeps.gitClient,
      stagingBranch: branch,
      baseBranch: stagingDeps.config.git.baseBranch,
      cwd: stagingDeps.targetRoot,
      orchestratorWorktreePath: stagingDeps.orchestratorWorktreePath
    });
    await seedFromLedger(specStore, request, seeded, stagingDeps, staging.stagingTip);
    await provisionProtection({
      ghClient: stagingDeps.ghClient,
      owner: stagingDeps.owner,
      repo: stagingDeps.repo,
      branch,
      requiredChecks: stagingDeps.config.git.stagingRequiredStatusChecks,
      provision: true
    });
    if (stagingDeps.config.git.developProtection === "run-scoped") {
      const base = stagingDeps.config.git.baseBranch;
      const checks = effectiveProfiles(
        stagingDeps.config.git,
        await loadRequiredCheckExtras(stagingDeps.targetRoot)
      ).run;
      const developState = await provisionProtection({
        ghClient: stagingDeps.ghClient,
        owner: stagingDeps.owner,
        repo: stagingDeps.repo,
        branch: base,
        requiredChecks: checks,
        provision: true
      });
      requireProtectionOrRefuse(developState, checks, base);
    }
  }
  return state.create({
    run_id: opts.runId,
    spec: specStore.toPointer(request),
    staging_branch: branch,
    // v1 orchestrator seam drives tasks strictly one at a time — the execution-mode dial is fixed.
    execution_mode: "sequential",
    tasks: seeded,
    // S11: the launch touch — every run costs at least one human action, so a
    // clean lights-out run scores exactly 1.0 on the derived touch metric.
    // `at` omitted → create() stamps it with the birth timestamp (=== started_at).
    human_touches: [{ kind: "launch" }],
    ...opts.shipMode !== void 0 ? { ship_mode: opts.shipMode } : {},
    ...opts.ownerSession !== void 0 ? { owner_session: opts.ownerSession } : {},
    ...opts.ignoreQuota === true ? { ignore_quota: true } : {},
    ...opts.e2e === true ? { e2e: true } : {},
    ...opts.debug === true ? { debug: true } : {}
  });
}
async function createRun(state, specStore, opts) {
  return createRunFromManifest(state, specStore, await resolveSpec2(specStore, opts), opts);
}
async function supersedeRun(state, existing, stagingDeps) {
  const branch = existing.staging_branch;
  await stagingDeps.ghClient.deleteProtection(stagingDeps.owner, stagingDeps.repo, branch);
  await stagingDeps.ghClient.deleteRemoteBranch(stagingDeps.owner, stagingDeps.repo, branch);
  if (stagingDeps.config.git.developProtection === "run-scoped" && !await state.hasOtherActiveForRepo(existing.spec.repo, existing.run_id)) {
    await putBaselineProtection({
      ghClient: stagingDeps.ghClient,
      owner: stagingDeps.owner,
      repo: stagingDeps.repo,
      branch: stagingDeps.config.git.baseBranch,
      contexts: effectiveProfiles(stagingDeps.config.git, await loadRequiredCheckExtras(stagingDeps.targetRoot)).baseline
    });
  }
  await state.finalize(
    existing.run_id,
    "superseded",
    "superseded by operator --supersede relaunch for the same PRD issue"
  );
}
async function resolveOrCreateRun(state, specStore, opts, stagingDeps) {
  const request = await resolveSpec2(specStore, opts);
  if (opts.intent === "fresh") {
    return {
      kind: "created",
      run: await createRunFromManifest(state, specStore, request, opts, stagingDeps)
    };
  }
  const pointer = specStore.toPointer(request);
  return state.withSpecLock(pointer.repo, pointer.spec_id, async () => {
    const existing = await state.findActiveByIssue(pointer.repo, pointer.issue_number);
    if (existing !== null) {
      const weeklyParked = existing.status === "suspended" && existing.quota?.binding_window === "7d";
      if (weeklyParked && opts.ignoreQuota !== true && opts.intent !== "resume") {
        return { kind: "pause", existing };
      }
      if (opts.intent === "supersede") {
        if (stagingDeps === void 0) {
          throw new UsageError("run create --supersede requires the CLI gh deps");
        }
        const supersededId = existing.run_id;
        await supersedeRun(state, existing, stagingDeps);
        const created = await createRunFromManifest(state, specStore, request, opts, stagingDeps);
        const run9 = await state.update(created.run_id, (s) => ({
          ...s,
          human_touches: [...s.human_touches, { kind: "conflict", at: s.started_at }]
        }));
        return { kind: "superseded", run: run9, supersededId };
      }
      return { kind: "exists", existing };
    }
    return {
      kind: "created",
      run: await createRunFromManifest(state, specStore, request, opts, stagingDeps)
    };
  });
}
async function applyResume(state, runId, reading, config, nowEpochSec, opts = {}) {
  const run9 = await state.read(runId);
  if (isTerminalRunStatus(run9.status)) {
    throw new Error(`run resume: run '${runId}' is terminal (${run9.status}); nothing to resume`);
  }
  if (run9.debug) {
    return { kind: "debug-resume", run_id: runId, run: run9 };
  }
  const plan = planResume(run9, reading, config, nowEpochSec);
  switch (plan.kind) {
    case "not-resumable":
      return { kind: "resumed", run: run9 };
    case "resume": {
      const at2 = epochToIso(nowEpochSec);
      const updated = await state.update(runId, (s) => ({
        ...s,
        status: plan.clear.status,
        quota: plan.clear.quota,
        ...opts.touch === false ? {} : { human_touches: [...s.human_touches, { kind: "resume", at: at2 }] }
      }));
      return { kind: "resumed", run: updated, cleared: true };
    }
    case "pause": {
      const d = plan.decision;
      if (d.kind === "proceed") {
        return { kind: "resumed", run: run9 };
      }
      const base = {
        kind: "pause",
        run_id: runId,
        status: run9.status,
        reason: d.reason
      };
      return "resetsAtEpoch" in d ? { ...base, resets_at_epoch: d.resetsAtEpoch } : base;
    }
  }
}

// src/cli/subcommands/run.ts
import { join as join25 } from "node:path";

// src/cli/wiring.ts
import { join as join23 } from "node:path";
function splitRepo(slug) {
  if (!isValidRepoSlug(slug)) {
    throw new Error(`wiring: run spec repo must be '<owner>/<name>' ([A-Za-z0-9._-], not '.'/'..'), got '${slug}'`);
  }
  const parts = slug.split("/");
  return { owner: at(parts, 0), repo: at(parts, 1) };
}
async function loadOrchestratorDeps(opts) {
  const deps = await loadCliDeps(opts);
  return {
    ...deps,
    usage: new StatuslineUsageSignal({ dataDir: deps.dataDir }),
    now: nowEpoch,
    docsApplicable: () => isDocsApplicable(process.cwd())
  };
}
function openState() {
  const dataDir = resolveDataDir({});
  return { dataDir, state: new StateManager({ dataDir }) };
}
async function loadCliDeps(opts) {
  const dataDir = resolveDataDir(opts);
  const dirOpts = { ...opts, dataDir };
  const config = loadConfig(dirOpts);
  const state = new StateManager({ ...dirOpts });
  const run9 = await state.read(opts.runId);
  const spec = await new SpecStore(dirOpts).read(run9.spec.repo, run9.spec.spec_id);
  const { owner, repo } = splitRepo(run9.spec.repo);
  const git = new DefaultGitClient();
  const repoRoot = await git.mainWorktreeRoot({ cwd: process.cwd() });
  const workDir = join23(repoRoot, ".claude", "worktrees");
  return {
    config,
    spec,
    git,
    gh: new DefaultGhClient(),
    tools: defaultGateTools(config.quality.gateEnv),
    holdout: new FsHoldoutStore(dataDir),
    dataDir,
    workDir,
    owner,
    repo,
    // The explicit `--ship-mode` flag overrides; otherwise honor the value
    // persisted on the run at create (manual/resume `drive`/`finalize` omit the
    // flag, and a `ship_mode: "live"` run must not silently downgrade to no-merge).
    shipMode: opts.shipMode ?? run9.ship_mode,
    designSystemDocs: () => findDesignSystemDocs(repoRoot),
    state,
    run: run9,
    targetRoot: repoRoot
  };
}

// src/cli/adoption.ts
var log34 = createLogger("adoption");
async function adoptForCli(deps, run9, at2) {
  let probe;
  try {
    probe = await reconcileRun(run9, deps.gh);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const report = await adoptFromReport({ state: deps.state, git: deps.git }, run9, probe, { at: at2 });
  return mirrorAdoption(deps.dataDir, run9.run_id, report);
}
async function mirrorAdoption(dataDir, runId, report) {
  for (const a of report.actions) {
    await emitMetric(dataDir, runId, "adoption", {
      class: a.class,
      action: a.action,
      ...a.task_id !== void 0 ? { task_id: a.task_id } : {},
      ...a.pr_number !== void 0 ? { pr_number: a.pr_number } : {}
    });
  }
  if (report.changed) {
    log34.info(`run '${runId}': adoption \u2014 ${summarizeAdoption(report)}`);
  }
  return { ok: true, ...report };
}

// src/cli/current.ts
async function readCurrentForCwd(state, overrides = {}) {
  const cwd = overrides.cwd ?? process.cwd();
  const gitClient = overrides.gitClient ?? new DefaultGitClient();
  let repo;
  try {
    repo = await resolveRepo({ cwd, gitClient });
  } catch (err) {
    if (err instanceof UsageError) {
      return null;
    }
    throw err;
  }
  return state.readCurrentForRepo(repo);
}
async function resolveRunIdOrCurrent(state, args, label, overrides = {}) {
  const explicit = optionalString(args.flag("run"));
  if (explicit !== void 0) {
    return explicit;
  }
  const current = await readCurrentForCwd(state, overrides);
  if (current === null) {
    throw new UsageError(`${label}: no --run given and no current run`);
  }
  return current.run_id;
}

// src/autonomy/mode.ts
function isAutonomous(env = process.env) {
  return env.FACTORY_AUTONOMOUS_MODE === "1";
}
var NotAutonomousError = class extends Error {
  constructor() {
    super(
      "Pipeline halted: not running in autonomous mode (FACTORY_AUTONOMOUS_MODE is unset).\nThe factory runs unattended and refuses to start or resume a run otherwise.\nRun `factory autonomy ensure`, then relaunch the session with:\n  claude --settings <merged-settings.json>\nCheck the current state any time with `factory autonomy status`."
    );
    this.name = "NotAutonomousError";
  }
};
function requireAutonomousMode(env = process.env) {
  if (!isAutonomous(env)) {
    throw new NotAutonomousError();
  }
}
function decideAutonomyPreflight(input) {
  const { autonomous, mergedSettingsPresent, expectedHash, storedHash } = input;
  if (!autonomous) {
    return {
      proceed: false,
      regenerate: true,
      reason: mergedSettingsPresent ? "not-autonomous" : "missing-settings"
    };
  }
  if (!mergedSettingsPresent) {
    return { proceed: true, regenerate: false, reason: "ci-raw-env" };
  }
  if (expectedHash === void 0) {
    return { proceed: true, regenerate: false, reason: "hash-unknowable" };
  }
  if (storedHash === void 0) {
    return { proceed: false, regenerate: true, reason: "unstamped" };
  }
  if (storedHash !== expectedHash) {
    return { proceed: false, regenerate: true, reason: "stale-settings" };
  }
  return { proceed: true, regenerate: false, reason: "fresh" };
}

// src/orchestrator/preflight.ts
import { readFile as readFile15 } from "node:fs/promises";
import { join as join24 } from "node:path";
var TCB_COVERED_TEST_DIRS = ["e2e", "./e2e"];
async function assertE2ePrereqs(cwd) {
  const missing = [];
  let pkgRaw;
  try {
    pkgRaw = await readFile15(join24(cwd, "package.json"), "utf8");
  } catch {
    missing.push("package.json");
  }
  if (pkgRaw !== void 0) {
    let hasDep2 = false;
    let parseable = true;
    try {
      const pkg = JSON.parse(pkgRaw);
      hasDep2 = pkg.dependencies?.["@playwright/test"] !== void 0 || pkg.devDependencies?.["@playwright/test"] !== void 0;
    } catch {
      parseable = false;
    }
    if (!parseable) {
      missing.push("a parseable package.json (current file is not valid JSON)");
    } else if (!hasDep2) {
      missing.push("@playwright/test (dependencies or devDependencies)");
    }
  }
  let configRaw;
  try {
    configRaw = await readFile15(join24(cwd, "playwright.config.ts"), "utf8");
  } catch {
    missing.push("playwright.config.ts");
  }
  if (missing.length > 0) {
    throw new UsageError(
      `run create: --e2e requires a Playwright-ready repo; missing: ${missing.join(", ")}. Run \`factory scaffold\` to seed playwright.config.ts + e2e/, and install @playwright/test.`
    );
  }
  if (configRaw !== void 0) {
    const declarations = [...configRaw.matchAll(/testDir\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (declarations.length > 1) {
      throw new UsageError(
        `run create: --e2e requires playwright.config.ts to declare testDir exactly once (found ${declarations.length}: ${declarations.join(", ")}). A multi-project or duplicated testDir config is ambiguous \u2014 the TCB write-deny protects the literal e2e/ path only, so a second declaration could route the real suite outside it. Collapse to a single top-level testDir: 'e2e'.`
      );
    }
    const declared = declarations[0];
    if (declared === void 0 || !TCB_COVERED_TEST_DIRS.includes(declared)) {
      const found = declared === void 0 ? "no testDir declaration" : `testDir '${declared}'`;
      throw new UsageError(
        `run create: --e2e requires playwright.config.ts to declare testDir 'e2e' (found ${found}). The TCB write-deny protects the literal e2e/ path only \u2014 a suite anywhere else would be write-open to the implementer. Run \`factory scaffold\` to seed the standard config.`
      );
    }
  }
}
async function assertGateContract(cwd, gitClient) {
  const load = await loadGateContract(cwd);
  if (load.state === "absent") {
    throw new UsageError(
      `run create: missing ${GATE_CONTRACT_REL} gate contract \u2014 run \`factory scaffold\` and commit the contract.`
    );
  }
  if (load.state === "invalid") {
    throw new UsageError(
      `run create: invalid ${GATE_CONTRACT_REL} gate contract (${load.error}) \u2014 fix it or delete it and re-run \`factory scaffold\`.`
    );
  }
  if (!await gitClient.isTracked(GATE_CONTRACT_REL, { cwd })) {
    throw new UsageError(
      `run create: ${GATE_CONTRACT_REL} exists but is not git-tracked \u2014 commit it so task worktrees see the contract.`
    );
  }
  return load.contract;
}

// src/cli/subcommands/run.ts
async function targetRootOrCwd(git) {
  try {
    return await git.mainWorktreeRoot({ cwd: process.cwd() });
  } catch {
    return process.cwd();
  }
}
var RUN_HELP = `factory run \u2014 create a run and drive its phases

Usage:
  factory run create [--repo <owner/name>] (--issue <n> | --spec-id <id>) [--run-id <id>]
  factory run finalize [--run <id>] [--no-ship]
  factory run traceability [--run <id>] [--results <path>]
  factory run docs [--run <id>] [--results <path>]
  factory run e2e [--run <id>] [--results <path>]
  factory run e2e-assess [--run <id>] [--results <path>]
  factory run stop [--run <id>] [--session-id <id>]
  factory run cancel [--run <id>] [--cleanup] [--session-id <id>]

Actions:
  create     Resolve a durable spec, create a run, seed its tasks, emit the RunState.
  finalize   Build the run report, post the deduped PRD failure comment, ship the rollup only when completed, flip terminal.
  traceability  Emit the PRD-traceability audit spawn request, or (with --results) record the auditor's verdicts.
  docs       Emit the documentation-phase spawn request, or (with --results) record a scribe result.
  e2e        Emit the e2e-phase spawn request, or (with --results) record the e2e author's manifest.
  e2e-assess Emit the run-start e2e-assessment spawn request, or (with --results) record the assessor's verdict.
  stop       Park a live run (suspended, resumable with \`factory resume\`); tasks untouched.
  cancel     Abandon a live run (mark it failed; NOT resumable); --cleanup also tears down its branch.`;
var CREATE_HELP = `factory run create \u2014 create a run and seed its tasks from a durable spec

Usage:
  factory run create [--repo <owner/name>] (--issue <n> | --spec-id <id>) [--run-id <id>] [--new | --supersede | --resume] [--no-ship] [--ignore-quota] [--e2e] [--approve-spec] [--session-id <id>]

  --repo        OPTIONAL. Repo identity 'owner/name' (the first key of the spec store).
                Auto-derived from the 'origin' remote when omitted; an explicit value
                that disagrees with the remote fails loud.
  --issue       PRD issue number \u2014 the STABLE lookup key (reruns reuse the spec).
  --spec-id     Explicit '<issue>-<slug>' spec id (alternative to --issue).
  --run-id      Override the generated 'run-YYYYMMDD-HHMMSS' id (determinism/tests).
                A named id is an address: it forces a fresh imperative create.
  --new         Force a fresh run even if a live one already exists for this spec.
  --supersede   Terminate the active run for this spec, then create a fresh one.
  --resume      Continue the active run for this spec (full hand-off: forthcoming).
  --no-ship     Open the rollup PR but never merge. Default (no flag): live \u2014 auto-merge
                each task into staging and merge the staging\u2192develop rollup into develop.
                Persisted on the run so resume + finalize read it without re-passing.
  --ignore-quota Bypass the weekly-quota hard stop AND the per-step quota pacer for this run.
                Persisted as ignore_quota:true so the orchestrator skips the gate
                without re-passing \u2014 lets create/--supersede proceed past a 7d-parked run.
  --e2e         Opt into the run-level e2e phase (Decision 39): after all tasks are terminal,
                author + run Playwright journeys against staging before docs/finalize; a
                mappable failing journey reopens its task with feedback. Persisted as e2e:true.
  --approve-spec Park the fully-created run (suspended, no quota checkpoint) for human spec
                sign-off before any agent runs (S9, Decision 47). The envelope names the
                spec.md to review; 'factory resume' IS the sign-off. Create-only; default off.
  --session-id  Owning Claude Code session id for the session-scoped Stop gate (Prompt J).
                Defaults to $CLAUDE_CODE_SESSION_ID; required \u2014 an ownerless run is rejected.

Resolves the spec via the durable store (LOUD if none exists \u2014 generate one first).
On an ACTIVE run for this (repo, spec_id): exits CONFLICT (3) and reports it \u2014 pass
--resume to continue it or --supersede to replace it; --new (or an explicit --run-id)
forces a fresh run regardless. Seeds one pending task per spec task and emits the
RunState JSON (run_id is the top-level field).`;
var RESUME_HELP = `factory resume \u2014 re-check quota and resume a paused/suspended run

Usage:
  factory resume [--run <id>] [--ignore-quota]

  --run            The run to resume (defaults to runs/current).
  --ignore-quota   Persist ignore_quota on the run and resume regardless of the
                   live usage reading (also skips re-suspension on later steps).

Emits ONE JSON envelope:
  { kind:"resumed", run }                              \u2014 window recovered (or already running)
  { kind:"pause", run_id, status, reason, \u2026 }  \u2014 window has not recovered (state untouched)
  { kind:"debug-resume", run_id, run }         \u2014 a /factory:debug run; resume it via factory debug

A terminal run is a loud error (nothing to resume).`;
var FINALIZE_HELP = `factory run finalize \u2014 turn an all-terminal run into its shipped outcome

Usage:
  factory run finalize [--run <id>] [--no-ship]

  --run       The run to finalize (defaults to runs/current).
  --no-ship   Open the rollup PR but never merge it \u2014 overrides the run's persisted ship
              mode for THIS finalize only. Default: honor the persisted ship_mode (live
              merges the staging\u2192develop rollup; no-merge opens it only).

Builds the deterministic partial-run report (report.md), emits run.finalized
telemetry, on a failed run comments the failed tasks on the PRD issue (deduped),
opens + CI-gates + (when shipping live) squash-merges the staging\u2192develop rollup,
then flips the run terminal \u2014 in that resume-safe order. LOUD if any task is still
non-terminal.

Emits ONE JSON envelope:
  { kind:"finalized", run, report, rollup?, failure_comment_posted }`;
var CANCEL_HELP = `factory run cancel \u2014 abandon a live run (mark it failed; not resumable)

WARNING: cancel is IRREVERSIBLE \u2014 the run is finalized 'failed' and can never be
resumed. To pause a run you intend to continue, use \`factory run stop\` instead.

Usage:
  factory run cancel [--run <id>] [--cleanup] [--session-id <id>]

  --run         The run to cancel. Default: the active run THIS session owns
                (--session-id / $CLAUDE_CODE_SESSION_ID), else runs/current.
  --cleanup     Also tear down the run's staging branch + task PRs (like --supersede).
                Default: leave them in place for manual handling.
  --session-id  Owning session id used to locate the run when --run is omitted
                (defaults to $CLAUDE_CODE_SESSION_ID).

The explicit abandon verb: marks the run 'failed' via the one sanctioned state writer \u2014
works even with a task still executing (no rollup CI, no ship). Idempotent; a run already
terminal as completed/superseded is a LOUD error. NOT resumable (cancelled is terminal) \u2014
start a fresh run instead. (A session no longer needs this to stop: the Stop hook lets a
session end and leaves the run resumable; cancel is for deliberately discarding a run.)

Emits ONE JSON envelope:
  { kind:"cancelled", run, cleaned_up }`;
var STOP_HELP = `factory run stop \u2014 park a live run (suspended; \`factory resume\` continues it)

Usage:
  factory run stop [--run <id>] [--session-id <id>]

  --run         The run to park. Default: the active run THIS session owns
                (--session-id / $CLAUDE_CODE_SESSION_ID), else runs/current.
  --session-id  Owning session id used to locate the run when --run is omitted
                (defaults to $CLAUDE_CODE_SESSION_ID).

The non-destructive stop verb (Decision 72): suspends the run WITHOUT a quota
checkpoint, so a plain \`factory resume\` un-parks it. Tasks are untouched. The
orchestrator's park guard keeps \`next-task\` from silently un-parking it.
Idempotent on an already paused/suspended run; a terminal run is a LOUD error.
To deliberately DISCARD a run instead, use \`factory run cancel\` (irreversible).

Emits ONE JSON envelope:
  { kind:"stopped", run, already_parked }`;
function parseIssue(raw) {
  if (raw === void 0) {
    return void 0;
  }
  if (typeof raw !== "string") {
    throw new UsageError("--issue requires a value");
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(`--issue must be a positive integer, got '${raw}'`);
  }
  return n;
}
function resolveOwnerSession(flag, env = process.env) {
  return optionalString(flag) ?? optionalString(env.CLAUDE_CODE_SESSION_ID);
}
async function runCreate(argv, overrides = {}) {
  const args = parseArgs(argv, {
    booleans: ["new", "no-ship", "supersede", "resume", "ignore-quota", "e2e", "approve-spec"]
  });
  if (args.flag("help") === true) {
    return emitHelp(CREATE_HELP);
  }
  requireAutonomousMode();
  const cwd = overrides.cwd ?? process.cwd();
  const gitClient = overrides.gitClient ?? new DefaultGitClient();
  const repoSlug = await resolveRepo({
    explicit: optionalString(args.flag("repo")),
    cwd,
    gitClient
  });
  const issue = parseIssue(args.flag("issue"));
  const specId = optionalString(args.flag("spec-id"));
  let selector;
  if (issue !== void 0 && specId !== void 0) {
    throw new UsageError("run create: pass exactly one of --issue or --spec-id");
  } else if (issue !== void 0) {
    selector = { issue };
  } else if (specId !== void 0) {
    selector = { specId };
  } else {
    throw new UsageError("run create requires --issue <n> or --spec-id <id>");
  }
  const explicitRunId = optionalString(args.flag("run-id"));
  const runId = explicitRunId ?? makeRunId();
  validateId(runId, "run-id");
  const shipMode = args.flag("no-ship") === true ? "no-merge" : "live";
  const ownerSession = resolveOwnerSession(args.flag("session-id"));
  if (ownerSession === void 0) {
    throw new UsageError(
      "run create: runs require an owning session id (pass --session-id <id> or set CLAUDE_CODE_SESSION_ID)."
    );
  }
  const fresh = args.flag("new") === true || explicitRunId !== void 0;
  const supersede = args.flag("supersede") === true;
  const resume = args.flag("resume") === true;
  if (resume && (args.flag("no-ship") === true || args.flag("e2e") === true)) {
    throw new UsageError(
      "run create: --no-ship/--e2e are create-only and cannot combine with --resume \u2014 a resumed run keeps the ship_mode/e2e it was created with. Drop the flag to continue the existing run, or use --supersede to start fresh."
    );
  }
  const approveSpec = args.flag("approve-spec") === true;
  if (approveSpec && resume) {
    throw new UsageError(
      "run create: --approve-spec is create-only and cannot combine with --resume \u2014 resuming a parked run IS the spec sign-off."
    );
  }
  if ([supersede, resume, fresh].filter(Boolean).length > 1) {
    throw new UsageError("run create: pass at most one of --new / --supersede / --resume");
  }
  const intent = supersede ? "supersede" : resume ? "resume" : fresh ? "fresh" : "default";
  const ignoreQuota = args.flag("ignore-quota") === true;
  const e2e = args.flag("e2e") === true;
  if (e2e) {
    await assertE2ePrereqs(cwd);
  }
  const contract = await assertGateContract(cwd, gitClient);
  const gatesInForce = enumerateGatesInForce(contract);
  for (const warning of gatesInForce.warnings) {
    emitError(`run create: ${warning}`);
  }
  const hasDataDirOverride = overrides.dataDir !== void 0;
  const dataDir = resolveDataDir(hasDataDirOverride ? { dataDir: overrides.dataDir } : {});
  const config = loadConfig({ dataDir });
  const state = new StateManager({ dataDir });
  const specStore = new SpecStore({ dataDir });
  const ghClient = overrides.ghClient ?? new DefaultGhClient();
  const { owner, repo } = splitRepoSlug(repoSlug);
  const repoRoot = await gitClient.showToplevel({ cwd });
  const stagingDeps = {
    gitClient,
    ghClient,
    config,
    targetRoot: cwd,
    orchestratorWorktreePath: join25(repoRoot, ".claude", "worktrees", `orchestrator-${runId}`),
    owner,
    repo
  };
  const result = await resolveOrCreateRun(
    state,
    specStore,
    {
      repo: repoSlug,
      runId,
      ...selector,
      shipMode,
      ownerSession,
      ...ignoreQuota ? { ignoreQuota } : {},
      ...e2e ? { e2e } : {},
      intent
    },
    stagingDeps
  );
  if (result.kind === "pause") {
    const r = result.existing;
    const resets = r.quota && r.quota.binding_window !== "unavailable" ? r.quota.resets_at_epoch : void 0;
    emitJson({
      kind: "pause",
      scope: "7d",
      run_id: r.run_id,
      status: r.status,
      reason: `weekly quota window has not reset; run '${r.run_id}' is parked until the 7d window resets`,
      ...resets !== void 0 ? { resets_at_epoch: resets } : {}
    });
    emitError(
      `run create: run '${r.run_id}' is parked on a weekly quota (7d) \u2014 resume after the window resets with /factory:resume, or pass --ignore-quota to override`
    );
    return EXIT.CONFLICT;
  }
  if (result.kind === "exists") {
    emitJson({
      kind: "exists",
      existing: { run_id: result.existing.run_id, status: result.existing.status }
    });
    emitError(
      `run create: active run '${result.existing.run_id}' already exists \u2014 pass --resume to continue it or --supersede to replace it`
    );
    return EXIT.CONFLICT;
  }
  const park = async (run9) => {
    const parked = await state.update(run9.run_id, (s) => ({
      ...s,
      status: "suspended"
    }));
    return {
      run: parked,
      spec_approval: {
        spec_path: join25(specDir(dataDir, repoSlug, run9.spec.spec_id), "spec.md"),
        note: "run parked for spec approval \u2014 review the spec, then run `factory resume`"
      }
    };
  };
  await emitMetric(dataDir, result.run.run_id, "human_touch", { kind: "launch" });
  const out = approveSpec ? await park(result.run) : { run: result.run };
  if (result.kind === "created") {
    emitJson({ kind: "created", ...out, gates: gatesInForce });
    return EXIT.OK;
  }
  await emitMetric(dataDir, result.run.run_id, "human_touch", { kind: "conflict" });
  emitJson({ kind: "superseded", ...out, gates: gatesInForce, supersededId: result.supersededId });
  return EXIT.OK;
}
async function runResume(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["no-ship", "ignore-quota", "e2e"] });
  if (args.flag("help") === true) {
    return emitHelp(RESUME_HELP);
  }
  if (args.flag("no-ship") === true || args.flag("e2e") === true) {
    throw new UsageError(
      "resume: --no-ship/--e2e are not valid on resume \u2014 a run keeps the ship_mode/e2e it was created with."
    );
  }
  requireAutonomousMode();
  const dataDir = resolveDataDir({});
  const config = loadConfig({ dataDir });
  const state = new StateManager({ dataDir });
  const runId = await resolveRunIdOrCurrent(state, args, "resume");
  if (args.flag("ignore-quota") === true) {
    await state.update(runId, (s) => ({ ...s, ignore_quota: true }));
  }
  const git = overrides.gitClient ?? new DefaultGitClient();
  const gh = overrides.ghClient ?? new DefaultGhClient();
  const at2 = overrides.now?.() ?? nowIso();
  const adoption = await adoptForCli({ state, git, gh, dataDir }, await state.read(runId), at2);
  const reading = await new StatuslineUsageSignal({ dataDir }).read();
  const envelope = await applyResume(state, runId, reading, config, nowEpoch());
  if (envelope.kind === "resumed" && envelope.cleared === true) {
    await emitMetric(dataDir, runId, "human_touch", { kind: "resume" });
  }
  if (envelope.kind === "resumed" && config.git.developProtection === "run-scoped") {
    const { owner, repo } = splitRepoSlug(envelope.run.spec.repo);
    const checks = effectiveProfiles(config.git, await loadRequiredCheckExtras(await targetRootOrCwd(git))).run;
    const developState = await provisionProtection({
      ghClient: gh,
      owner,
      repo,
      branch: config.git.baseBranch,
      requiredChecks: checks,
      provision: true
    });
    requireProtectionOrRefuse(developState, checks, config.git.baseBranch);
  }
  emitJson({ ...envelope, adoption });
  return EXIT.OK;
}
async function runFinalize(argv) {
  const args = parseArgs(argv, { booleans: ["no-ship"] });
  if (args.flag("help") === true) {
    return emitHelp(FINALIZE_HELP);
  }
  const shipMode = args.flag("no-ship") === true ? "no-merge" : void 0;
  const { dataDir, state } = openState();
  const runId = await resolveRunIdOrCurrent(state, args, "run finalize");
  emitJson(await finalizedEnvelope(dataDir, runId, shipMode));
  return EXIT.OK;
}
async function finalizedEnvelope(dataDir, runId, shipMode) {
  const deps = await loadCliDeps({
    dataDir,
    runId,
    ...shipMode !== void 0 ? { shipMode } : {}
  });
  const { run: run9, report, rollup: rollup2, failureCommentPosted } = await finalizeRun(deps, runId);
  return {
    kind: "finalized",
    run: run9,
    report,
    ...rollup2 !== void 0 ? { rollup: rollup2 } : {},
    failure_comment_posted: failureCommentPosted
  };
}
var DOCS_HELP = `factory run docs [--run <id>] [--results <path>]

Emit the documentation-phase spawn request, or (with --results) record a scribe
result: publish the docs commit onto staging and mark the phase done, or suspend
the run on failure. The CLI never spawns scribe \u2014 a orchestrator does.`;
function phaseCommand(opts) {
  return async (argv) => {
    const args = parseArgs(argv, { booleans: [] });
    if (args.flag("help") === true) {
      emitLine(opts.help);
      return EXIT.OK;
    }
    const { dataDir, state } = openState();
    const runId = await resolveRunIdOrCurrent(state, args, `run ${opts.phase}`);
    const deps = await loadCliDeps({ dataDir, runId });
    const results = await parseResultsFlag(args, async (path7) => opts.parse(await readJsonInput(path7)));
    emitJson(results !== void 0 ? await opts.record(deps, runId, results) : await opts.emit(deps, runId));
    return EXIT.OK;
  };
}
var runDocs = phaseCommand({
  help: DOCS_HELP,
  phase: "docs",
  parse: (raw) => DocsResultsSchema.parse(raw),
  record: runDocsRecord,
  emit: runDocsEmit
});
var TRACE_HELP = `factory run traceability [--run <id>] [--results <path>]

Emit the PRD-traceability audit spawn request (S9, Decision 47), or (with
--results) record the auditor's per-requirement verdicts: all met/partial \u2192
phase done; any unmet \u2192 run condemned (finalize blocks the rollup); a crashed
auditor retries once, then fails the run. The CLI never spawns the auditor \u2014 a
orchestrator does.`;
var runTraceability = phaseCommand({
  help: TRACE_HELP,
  phase: "traceability",
  parse: (raw) => TraceabilityResultsSchema.parse(raw),
  record: runTraceabilityRecord,
  emit: runTraceabilityEmit
});
var E2E_HELP = `factory run e2e [--run <id>] [--results <path>]

Emit the e2e-phase spawn request (author or run-suite, Decision 39), or (with
--results) record the e2e-author's manifest: prove + commit critical journeys,
run the full suite against staging, and either mark the phase done, reopen a
mappable failing task with feedback, or fail the run. The CLI never spawns the
e2e author \u2014 a orchestrator does.`;
var runE2ePhase = phaseCommand({
  help: E2E_HELP,
  phase: "e2e",
  parse: (raw) => E2eResultsSchema.parse(raw),
  record: runE2eRecord,
  emit: runE2eEmit
});
var E2E_ASSESS_HELP = `factory run e2e-assess [--run <id>] [--results <path>]

Emit the run-start e2e-assessment spawn request (Decision 40), or (with --results)
record the assessor's verdict: merge validated machinery (e2e/** +
playwright.config.ts only) and persist the coverage forecast, retry a crashed
assessor once, or fail the run LOUD on a boot/machinery-impossible verdict
(every non-terminal task swept blocked-environmental). The CLI never spawns the
assessor \u2014 a orchestrator does.`;
var runE2eAssess = phaseCommand({
  help: E2E_ASSESS_HELP,
  phase: "e2e-assess",
  parse: (raw) => AssessmentResultsSchema.parse(raw),
  record: runAssessmentRecord,
  emit: runAssessmentEmit
});
async function resolveCancelRunId(state, args, sessionId, overrides = {}, verb = "cancel") {
  const explicit = optionalString(args.flag("run"));
  if (explicit !== void 0) {
    return explicit;
  }
  if (sessionId !== void 0) {
    const owned = await state.findAllActiveByOwner(sessionId);
    if (owned.length === 1) {
      return nonNull(owned[0]).run_id;
    }
    if (owned.length >= 2) {
      const ids = owned.map((r) => r.run_id).join(", ");
      throw new UsageError(
        `run ${verb}: session '${sessionId}' owns ${owned.length} live runs (${ids}); pass --run <id> to choose which to ${verb}`
      );
    }
  }
  const current = await readCurrentForCwd(state, overrides);
  if (current === null) {
    throw new UsageError(`run ${verb}: no --run given and no owned/current run to ${verb}`);
  }
  return current.run_id;
}
async function runStop(argv, overrides = {}) {
  const args = parseArgs(argv, {});
  if (args.flag("help") === true) {
    return emitHelp(STOP_HELP);
  }
  const dataDir = resolveDataDir(overrides.dataDir !== void 0 ? { dataDir: overrides.dataDir } : {});
  const state = new StateManager({ dataDir });
  const sessionId = resolveOwnerSession(args.flag("session-id"));
  const currentOverrides = {
    ...overrides.gitClient !== void 0 ? { gitClient: overrides.gitClient } : {},
    ...overrides.cwd !== void 0 ? { cwd: overrides.cwd } : {}
  };
  const runId = await resolveCancelRunId(state, args, sessionId, currentOverrides, "stop");
  let run9 = await state.read(runId);
  if (isTerminalRunStatus(run9.status)) {
    throw new UsageError(`run stop: run '${runId}' is already terminal (${run9.status}) \u2014 nothing to park`);
  }
  const alreadyParked = run9.status === "paused" || run9.status === "suspended";
  if (!alreadyParked) {
    run9 = await state.update(runId, (s) => ({ ...s, status: "suspended" }));
  }
  emitJson({ kind: "stopped", run: run9, already_parked: alreadyParked });
  emitError(
    `run ${runId} parked (suspended, no quota checkpoint) \u2014 \`factory resume\` continues it. To deliberately discard it instead, use \`factory run cancel\` (irreversible).`
  );
  return EXIT.OK;
}
async function runCancel(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["cleanup"] });
  if (args.flag("help") === true) {
    return emitHelp(CANCEL_HELP);
  }
  const dataDir = resolveDataDir(overrides.dataDir !== void 0 ? { dataDir: overrides.dataDir } : {});
  const state = new StateManager({ dataDir });
  const sessionId = resolveOwnerSession(args.flag("session-id"));
  const currentOverrides = {
    ...overrides.gitClient !== void 0 ? { gitClient: overrides.gitClient } : {},
    ...overrides.cwd !== void 0 ? { cwd: overrides.cwd } : {}
  };
  const runId = await resolveCancelRunId(state, args, sessionId, currentOverrides);
  const pre = await state.read(runId);
  if (!isTerminalRunStatus(pre.status)) {
    const inFlight = /* @__PURE__ */ new Set(["executing", "reviewing", "shipping"]);
    if (Object.values(pre.tasks).some((t) => inFlight.has(t.status))) {
      await state.update(runId, (s) => ({
        ...s,
        tasks: Object.fromEntries(
          Object.entries(s.tasks).map(
            ([id, t]) => inFlight.has(t.status) ? [
              id,
              {
                ...t,
                status: "failed",
                failure_class: "blocked-environmental",
                failure_reason: "run cancelled by operator",
                ended_at: t.ended_at ?? nowIso(),
                spawn_in_flight: void 0
              }
            ] : [id, t]
          )
        )
      }));
    }
  }
  const run9 = await state.finalize(runId, "failed", "run cancelled by operator");
  const cleanup = args.flag("cleanup") === true;
  const branch = run9.staging_branch;
  let cleanedUp = false;
  let cleanupError;
  if (cleanup) {
    const ghClient = overrides.ghClient ?? new DefaultGhClient();
    const { owner, repo } = splitRepoSlug(run9.spec.repo);
    try {
      await ghClient.deleteProtection(owner, repo, branch);
      await ghClient.deleteRemoteBranch(owner, repo, branch);
      const config = loadConfig({ dataDir });
      if (config.git.developProtection === "run-scoped" && !await state.hasOtherActiveForRepo(run9.spec.repo, run9.run_id)) {
        await putBaselineProtection({
          ghClient,
          owner,
          repo,
          branch: config.git.baseBranch,
          // Best-effort extras: cancel needs no cwd, so outside the repo
          // this degrades to the config baseline (loadRequiredCheckExtras
          // never throws — de-escalation must not fail on a missing contract).
          contexts: effectiveProfiles(
            config.git,
            await loadRequiredCheckExtras(
              await targetRootOrCwd(overrides.gitClient ?? new DefaultGitClient())
            )
          ).baseline
        });
      }
      cleanedUp = true;
    } catch (err) {
      cleanupError = err instanceof Error ? err.message : String(err);
    }
  }
  emitJson({
    kind: "cancelled",
    run: run9,
    cleaned_up: cleanedUp,
    ...cleanupError !== void 0 ? { cleanup_error: cleanupError } : {}
  });
  if (cleanupError !== void 0) {
    emitError(
      `run ${run9.run_id} cancelled (marked failed), but --cleanup did NOT finish for staging branch '${branch}': ${cleanupError}. The branch may still exist \u2014 re-run \`factory run cancel --run ${run9.run_id} --cleanup\` to retry the teardown.`
    );
  } else {
    emitError(
      `run ${run9.run_id} cancelled (marked failed; NOT resumable \u2014 \`factory run stop\` is the resumable alternative)` + (cleanup ? `; staging branch '${branch}' + its task PRs torn down.` : `; staging branch '${branch}' left in place \u2014 delete it manually or re-run with --cleanup (which also drops develop back to its baseline protection in run-scoped mode).`)
    );
  }
  return EXIT.OK;
}
async function run2(argv) {
  const action = argv[0];
  if (action === void 0 || action === "--help" || action === "-h") {
    emitLine(RUN_HELP);
    return EXIT.OK;
  }
  const rest = argv.slice(1);
  switch (action) {
    case "create":
      return runCreate(rest);
    case "finalize":
      return runFinalize(rest);
    case "traceability":
      return runTraceability(rest);
    case "docs":
      return runDocs(rest);
    case "e2e":
      return runE2ePhase(rest);
    case "e2e-assess":
      return runE2eAssess(rest);
    case "stop":
      return runStop(rest);
    case "cancel":
      return runCancel(rest);
    default:
      throw new UsageError(
        `unknown run action '${action}' (expected create | finalize | traceability | docs | e2e | e2e-assess | stop | cancel)`
      );
  }
}
var runCommand = {
  describe: "Create a run (resolve+seed a spec) and drive its phases",
  run: withUsageGuard("run", run2)
};
var resumeCommand = {
  describe: "Resume a paused/suspended run (re-check quota; clear a recovered checkpoint)",
  run: withUsageGuard("resume", runResume)
};

// src/cli/subcommands/spec.ts
var SPEC_HELP = `factory spec \u2014 deterministic spec-build seam (resolve \u2192 gate \u2192 store)

Usage:
  factory spec resolve [--repo <owner/name>] --issue <n> [--supersede] [--ignore-quota]
  factory spec gate    [--repo <owner/name>] --issue <n>
  factory spec store   [--repo <owner/name>] --issue <n>

--repo is OPTIONAL: auto-derived from the 'origin' remote when omitted; an explicit
value that disagrees with the remote fails loud.

The in-session runner drives the agent spawns; the ENGINE bounds the regen loop
(scratch attempts.json; over spec.maxRegenIterations \u2192 terminal spec-defect, exit 1)
and quota-gates resolve (pause envelope; --ignore-quota overrides). Each action emits
ONE JSON envelope naming the next step. Scratch JSON is threaded through the OS temp
dir, factory-spec-build/<repo>/<issue>/{prd,generated,verdict,attempts}.json
(transient pre-validation agent output, never the plugin data dir).

Actions:
  resolve  Reuse an existing spec by issue, else fetch the PRD + emit the generate spawn.
  gate     Run the deterministic spec gates; emit revise (blockers) or the review spawn.
  store    Adjudicate the review (56/60 + floor); emit revise or persist + emit the pointer.`;
function parseIssue2(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(`--issue must be a positive integer, got '${raw}'`);
  }
  return n;
}
function wireDeps() {
  const dataDir = resolveDataDir({});
  const config = loadConfig({ dataDir });
  return {
    store: new SpecStore({ dataDir }),
    gh: new RealGhClient({ bodyMaxBytes: config.spec.prdBodyMaxBytes }),
    config,
    usage: new StatuslineUsageSignal({ dataDir }),
    now: nowEpoch,
    scratchRoot: defaultSpecBuildRoot()
  };
}
async function weeklyParkedPause(repo, issue) {
  const run9 = await new StateManager({}).findActiveByIssue(repo, issue);
  const quota = run9?.quota;
  if (run9?.status !== "suspended" || quota?.binding_window !== "7d") {
    return null;
  }
  return {
    kind: "pause",
    repo,
    issue,
    scope: "7d",
    reason: `run '${run9.run_id}' is weekly-parked (7d quota window); superseding would strand it \u2014 resume with /factory:resume after the window resets, or pass --ignore-quota`,
    resets_at_epoch: quota.resets_at_epoch
  };
}
var ACTIONS = {
  resolve: resolveSpec,
  gate: gateSpec,
  store: storeSpec
};
async function resolveSpecRepo(args, overrides = {}) {
  return resolveRepo({
    explicit: optionalString(args.flag("repo")),
    cwd: overrides.cwd ?? process.cwd(),
    gitClient: overrides.gitClient ?? new DefaultGitClient()
  });
}
async function run3(argv) {
  const action = argv[0];
  if (action === void 0 || action === "--help" || action === "-h") {
    emitLine(SPEC_HELP);
    return EXIT.OK;
  }
  const handler = ACTIONS[action];
  if (handler === void 0) {
    throw new UsageError(`unknown spec action '${action}' (expected resolve | gate | store)`);
  }
  const args = parseArgs(argv.slice(1), { booleans: ["supersede", "ignore-quota"] });
  if (args.flag("help") === true) {
    return emitHelp(SPEC_HELP);
  }
  const issue = parseIssue2(args.requireFlag("issue"));
  const repo = await resolveSpecRepo(args);
  const supersede = args.flag("supersede") === true;
  const ignoreQuota = args.flag("ignore-quota") === true;
  if (action === "resolve" && supersede && !ignoreQuota) {
    const parked = await weeklyParkedPause(repo, issue);
    if (parked !== null) {
      emitJson(parked);
      return specExitCode(parked);
    }
  }
  const deps = wireDeps();
  const envelope = action === "resolve" ? await resolveSpec(deps, repo, issue, { regenerate: supersede, ignoreQuota }) : await handler(deps, repo, issue);
  emitJson(envelope);
  if (envelope.kind === "unspecifiable") {
    emitError(
      `PRD #${issue} is not specifiable \u2014 fix the PRD and re-run:
` + envelope.blockers.map((b) => `  - ${b}`).join("\n")
    );
  }
  if (envelope.kind === "spec-defect") {
    emitError(
      `spec regeneration bound exhausted for #${issue} (${envelope.iterations}/${envelope.max_iterations}) \u2014 rework the PRD (or raise spec.maxRegenIterations) and re-run; latest blockers:
` + envelope.blockers.map((b) => `  - ${b}`).join("\n")
    );
  }
  return specExitCode(envelope);
}
function specExitCode(envelope) {
  return envelope.kind === "unspecifiable" || envelope.kind === "spec-defect" ? EXIT.ERROR : EXIT.OK;
}
var specCommand = {
  describe: "Build a durable spec (resolve \u2192 gate \u2192 store; runner drives the agent spawns)",
  run: withUsageGuard("spec", run3)
};

// src/debug/review.ts
async function buildReviewManifest(opts) {
  const crossVendorPrompt = opts.crossVendor.status === "present" ? await composeCrossVendorPrompt({
    pluginRoot: resolvePluginRoot(),
    baseRef: opts.base,
    worktree: opts.worktree,
    ...opts.priorDispositions !== void 0 ? { priorDispositions: opts.priorDispositions } : {}
  }) : void 0;
  const manifest = buildPanelManifest(opts.resumePhase, opts.crossVendor, false, crossVendorPrompt);
  return {
    manifest,
    base: opts.base,
    worktree: opts.worktree,
    codexAvailable: opts.crossVendor.status === "present",
    ...opts.crossVendor.status === "absent" ? { codexAbsentReason: opts.crossVendor.reason } : {}
  };
}
async function adjudicateWholeScope(input) {
  const reviews = input.reviews.map(parseRawReview);
  const source = await buildWorktreeSource(input.worktree, reviews);
  const makeRunner2 = makeReplayRunnerFactory({
    reviews: input.reviews,
    verifications: input.verifications,
    ...input.crossVendorAbsent !== void 0 ? { crossVendorAbsent: input.crossVendorAbsent } : {}
  });
  const result = await runPanel({
    reviews,
    source,
    makeRunner: makeRunner2,
    gateEvidence: [],
    phase: "verify",
    redact: true
  });
  const erroredReviewers = result.adjudicated.filter((a) => a.hadVerifierError).map((a) => a.reviewer);
  if (erroredReviewers.length > 0) {
    throw new Error(
      `adjudicateWholeScope: finding-verifier error for reviewer(s) ${erroredReviewers.join(", ")} \u2014 a blocking finding's confirmation status could not be determined for this pass. Retry the verify spawn for the affected reviewer(s) and re-record before this pass can be judged clean or findings.`
    );
  }
  const confirmedBlockers = result.adjudicated.flatMap((a) => a.confirmedBlockers);
  return {
    adjudicated: result.adjudicated,
    reviews,
    confirmedBlockers,
    clean: confirmedBlockers.length === 0
  };
}
async function runCommittedE2e(input, tool = new DefaultPlaywrightTool()) {
  const { config } = input;
  if (config.startCommand == null || config.startCommand.length === 0 || config.baseURL == null || config.baseURL.length === 0) {
    return {
      kind: "skipped",
      reason: "e2e.startCommand/e2e.baseURL not configured \u2014 run `factory configure --set e2e.startCommand=<cmd> --set e2e.baseURL=<url>`"
    };
  }
  let results;
  try {
    results = await runE2e(
      {
        cwd: input.cwd,
        env: scrubbedE2eEnv(config, {
          startCommand: nonNull(config.startCommand),
          baseURL: nonNull(config.baseURL)
        }),
        replaceEnv: true,
        testDir: E2E_TEST_DIR
      },
      tool
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      kind: "ran",
      results: { ok: false, specs: [], counts: { passed: 0, failed: 0, flaky: 0, skipped: 0 } },
      findings: [
        {
          reviewer: "e2e",
          severity: "critical",
          blocking: true,
          quote: "(uncitable \u2014 e2e tooling failure, no per-spec citation available)",
          claim: "the Playwright e2e run itself failed (tooling error, not a spec failure)",
          description: `e2e tooling error \u2014 the Playwright run itself failed: ${detail}`
        }
      ]
    };
  }
  const findings = results.specs.filter((spec) => spec.status === "failed").map((spec) => ({
    reviewer: "e2e",
    severity: "critical",
    blocking: true,
    file: spec.file,
    line: 1,
    quote: spec.title,
    // claim is schema-bounded to 300 chars; a Playwright title can exceed it.
    claim: `e2e spec failed: ${spec.title}`.slice(0, 300),
    description: `e2e spec failed: ${spec.title}`
  }));
  if (!results.ok && results.counts.failed === 0) {
    findings.push({
      reviewer: "e2e",
      severity: "critical",
      blocking: true,
      quote: "(uncitable \u2014 e2e tooling failure, no per-spec citation available)",
      claim: "the e2e run failed as a whole with no individually-failed spec",
      description: "e2e tooling failed with no per-spec failures \u2014 investigate the Playwright run"
    });
  }
  return { kind: "ran", results, findings };
}
function foldE2eIntoBlockers(confirmedBlockers, e2e) {
  return e2e.kind === "skipped" ? confirmedBlockers : [...confirmedBlockers, ...e2e.findings];
}

// src/debug/spec-source.ts
var DEBUG_ISSUE_BASE = 2e9;
function debugIssueNumber(passNumber) {
  if (!Number.isInteger(passNumber) || passNumber < 1) {
    throw new Error(`debugIssueNumber: passNumber must be a positive integer, got ${passNumber}`);
  }
  return DEBUG_ISSUE_BASE + passNumber;
}
var ReportGhClient = class {
  constructor(report) {
    this.report = report;
  }
  fetchPrd(issueNumber, _opts) {
    return Promise.resolve({
      issue_number: issueNumber,
      title: this.report.title,
      body: this.report.body,
      labels: ["factory-debug"],
      body_truncated: false
    });
  }
};
function renderFinding(finding) {
  const citation = finding.file !== void 0 && finding.line !== void 0 ? `${finding.file}:${finding.line}` : "(no citation)";
  return [`### [${finding.severity}] ${citation}`, "", `> ${finding.quote}`, "", finding.description].join("\n");
}
function renderFindingsBody(confirmedBlockers) {
  const byReviewer = /* @__PURE__ */ new Map();
  for (const finding of confirmedBlockers) {
    const bucket = byReviewer.get(finding.reviewer);
    if (bucket) {
      bucket.push(finding);
    } else {
      byReviewer.set(finding.reviewer, [finding]);
    }
  }
  const sections = [];
  for (const [reviewer, findings] of byReviewer) {
    sections.push(`## ${reviewer}`, "", findings.map(renderFinding).join("\n\n"));
  }
  return sections.join("\n\n");
}
function renderAcceptanceCriteria(confirmedBlockers) {
  const bullets = confirmedBlockers.map((f) => {
    const citation = f.file !== void 0 && f.line !== void 0 ? `${f.file}:${f.line}` : "(no citation)";
    return `- The finding at ${citation} (${f.severity}, ${f.reviewer}) is fixed.`;
  });
  return ["## Acceptance Criteria", "", ...bullets].join("\n");
}
function buildDebugReport(input) {
  const { confirmedBlockers, passNumber, base } = input;
  const title = `factory debug pass ${passNumber} \u2014 ${confirmedBlockers.length} blocking finding(s)`;
  const header = [
    `# Factory Debug Pass ${passNumber}`,
    "",
    `Scan base: \`${base}\``,
    "",
    `${confirmedBlockers.length} blocking finding(s) confirmed by the whole-scope review panel. Each finding below is a citation-verified, independently-confirmed blocker (reviewer, severity, exact file:line, the quoted offending code, and the reviewer's description). Treat this as the PRD: derive tasks that fix every finding below.`
  ].join("\n");
  const body = confirmedBlockers.length === 0 ? `${header}

(no confirmed blockers)` : `${header}

${renderFindingsBody(confirmedBlockers)}

${renderAcceptanceCriteria(confirmedBlockers)}`;
  return { title, body };
}
function wireDebugSpecDeps(report, dataDirOverride) {
  const dataDir = dataDirOverride ?? resolveDataDir({});
  const config = loadConfig({ dataDir });
  return {
    store: new SpecStore({ dataDir }),
    gh: new ReportGhClient(report),
    config,
    usage: new StatuslineUsageSignal({ dataDir }),
    now: nowEpoch,
    scratchRoot: defaultSpecBuildRoot()
  };
}

// src/debug/batch.ts
function namespacedId(passNumber, taskId) {
  return `p${passNumber}-${taskId}`;
}
function appendTasksFromSpec(existingTasks, request, passNumber) {
  const ctx = {
    context: "appendTasksFromSpec",
    specLabel: `spec ${request.spec_id} (pass ${passNumber})`
  };
  const newBatch = seedTaskRows(request.tasks, ctx, (id) => namespacedId(passNumber, id));
  const merged = { ...existingTasks, ...newBatch };
  assertAcyclic(merged, ctx);
  return merged;
}

// src/cli/subcommands/debug.ts
var EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var DEFAULT_MAX_PASSES = 5;
var DEBUG_SESSION_FILE = "session.json";
var DEBUG_HELP = `factory debug \u2014 the /factory:debug whole-scope review\u21C4fix loop

Usage:
  factory debug start [--base <ref> | --full] [--no-ship] [--author-e2e] [--max-passes <n>] [--session-id <id>]
  factory debug review --emit --run <id>
  factory debug review --record --run <id> --results <path>
  factory debug spec resolve --run <id>
  factory debug spec gate    --run <id>
  factory debug spec store   --run <id>
  factory debug seed --run <id>
  factory debug finalize --run <id> [--no-ship]

The in-session runner drives the agent spawns (the whole-scope review panel)
AND the bounded review\u21C4fix loop across passes; each action emits ONE JSON
envelope naming the next step. Scratch JSON is threaded through
<dataDir>/debug/<run-id>/{session.json,pass-<n>/findings.{json,md}}.

Actions:
  start     Cut the debug staging branch, mint the run id, emit the pass-1 review scope.
  review    --emit spawns the whole-scope panel; --record adjudicates its output.
  spec      Thin pass-through to 'factory spec resolve|gate|store' fed a synthetic PRD.
  seed      Create (pass 1) or append (pass > 1) the run's tasks from the resolved spec.
  finalize  Turn an all-terminal debug run into its shipped outcome.`;
var START_HELP = `factory debug start \u2014 cut the debug staging branch and mint a run id

Usage:
  factory debug start [--base <ref> | --full] [--no-ship] [--author-e2e] [--max-passes <n>] [--session-id <id>]

  --base         Diff base for the whole-scope review. Default: HEAD~1.
  --full         Review the ENTIRE tree (diff against the empty-tree SHA) instead of --base.
                 Mutually exclusive with --base.
  --no-ship      Persist no-merge ship mode for the eventual debug run (default: live).
  --author-e2e   Persist e2e:true on the eventual debug run (opt into the e2e-authoring phase).
  --max-passes   Cap on review\u21C4fix passes before the driver must stop looping. Default: ${DEFAULT_MAX_PASSES}.
  --session-id   Owning Claude Code session id (defaults to $CLAUDE_CODE_SESSION_ID).

Emits { kind:"review", run_id, base, worktree, pass:1 }.`;
var REVIEW_HELP = `factory debug review \u2014 spawn or record the whole-scope review panel

Usage:
  factory debug review --emit --run <id>
  factory debug review --record --run <id> --results <path>

--results is a JSON file shaped { reviews, verifications, crossVendorAbsent? } \u2014
IDENTICAL to the per-task merge-gate's record-reviews input shape.

Emits { kind:"review-spawn", run_id, pass, manifest, base, worktree, codex_available }
on --emit, or { kind:"clean", run_id, pass, e2e } | { kind:"findings", run_id, pass,
report_path, confirmed_count, e2e } on --record, where e2e is
{ kind:"ran" } | { kind:"skipped", reason }.`;
var SPEC_SUB_HELP = `factory debug spec \u2014 thin pass-through to 'factory spec' fed a synthetic PRD

Usage:
  factory debug spec resolve --run <id>
  factory debug spec gate    --run <id>
  factory debug spec store   --run <id>

Reads the pass's confirmed blockers from the debug session, renders them as a
synthetic PRD (src/debug/spec-source.ts), and calls the UNCHANGED
resolveSpec/gateSpec/storeSpec \u2014 returns their envelope verbatim.`;
var SEED_HELP = `factory debug seed \u2014 create (pass 1) or append (pass > 1) the run's tasks

Usage:
  factory debug seed --run <id>

Emits { kind:"loop", run_id }.`;
var FINALIZE_HELP2 = `factory debug finalize \u2014 turn an all-terminal debug run into its shipped outcome

Usage:
  factory debug finalize --run <id> [--no-ship]

Delegates to the UNCHANGED finalizeRun exactly once (mirrors 'factory run finalize').
Emits { kind:"finalized", run, report, rollup?, failure_comment_posted }, or
{ kind:"nothing-to-ship", run_id } when the session converged clean before any
RunState was ever created (no 'debug seed' ever ran).`;
function debugSessionPath(dataDir, runId) {
  return join26(dataDir, "debug", runId, DEBUG_SESSION_FILE);
}
function debugPassDir(dataDir, runId, pass) {
  return join26(dataDir, "debug", runId, `pass-${pass}`);
}
async function readSession(dataDir, runId) {
  return readJsonFile(debugSessionPath(dataDir, runId));
}
async function writeSession(dataDir, session) {
  await writeJsonFile(debugSessionPath(dataDir, session.runId), session);
}
async function debugStart(deps, opts = {}) {
  if (opts.full === true && opts.base !== void 0) {
    throw new UsageError("debug start: pass exactly one of --base or --full");
  }
  const base = opts.full === true ? EMPTY_TREE_SHA : opts.base ?? "HEAD~1";
  const maxPasses = opts.maxPasses ?? DEFAULT_MAX_PASSES;
  if (!Number.isInteger(maxPasses) || maxPasses <= 0) {
    throw new UsageError(`--max-passes must be a positive integer, got '${String(opts.maxPasses)}'`);
  }
  const runId = makeRunId();
  validateId(runId, "run-id");
  const headSha = await deps.gitClient.revParse("HEAD", { cwd: deps.cwd });
  const stagingBranch = runStagingBranch(runId);
  await deps.gitClient.checkoutB(stagingBranch, headSha, { cwd: deps.cwd });
  await deps.gitClient.push("origin", stagingBranch, { setUpstream: true, cwd: deps.cwd });
  const session = {
    runId,
    base,
    pass: 1,
    maxPasses,
    noShip: opts.noShip === true,
    authorE2e: opts.authorE2e === true,
    ...opts.sessionId !== void 0 ? { sessionId: opts.sessionId } : {}
  };
  await writeSession(deps.dataDir, session);
  return { kind: "review", run_id: runId, base, worktree: deps.cwd, pass: 1 };
}
async function debugReviewEmit(deps, runId) {
  const session = await readSession(deps.dataDir, runId);
  const crossVendor = await resolveCodexCrossVendor(deps.config.codex.model, deps.vendorProbe);
  const priorDispositions = renderDispositionLedger(session.dispositions);
  const built = await buildReviewManifest({
    resumePhase: "verify",
    base: session.base,
    worktree: deps.cwd,
    crossVendor,
    ...priorDispositions !== void 0 ? { priorDispositions } : {}
  });
  return {
    kind: "review-spawn",
    run_id: runId,
    pass: session.pass,
    manifest: built.manifest,
    base: built.base,
    worktree: built.worktree,
    codex_available: built.codexAvailable,
    ...built.codexAbsentReason !== void 0 ? { codex_absent_reason: built.codexAbsentReason } : {},
    ...priorDispositions !== void 0 ? { prior_dispositions: priorDispositions } : {}
  };
}
async function debugReviewRecord(deps, runId, input) {
  const session = await readSession(deps.dataDir, runId);
  const worktree = deps.cwd;
  const adjudicated = await adjudicateWholeScope({
    reviews: input.reviews,
    verifications: input.verifications,
    worktree,
    ...input.crossVendorAbsent !== void 0 ? { crossVendorAbsent: input.crossVendorAbsent } : {}
  });
  const e2e = await runCommittedE2e({ cwd: worktree, config: deps.config.e2e });
  const confirmedBlockers = foldE2eIntoBlockers(adjudicated.confirmedBlockers, e2e);
  const e2eStatus = e2e.kind === "skipped" ? { kind: "skipped", reason: e2e.reason } : { kind: "ran" };
  const dispositions = appendDispositions(
    session.dispositions,
    composeDispositions(adjudicated.reviews, adjudicated.adjudicated, session.pass)
  );
  await writeSession(deps.dataDir, { ...session, confirmedBlockers, dispositions });
  if (confirmedBlockers.length === 0) {
    return { kind: "clean", run_id: runId, pass: session.pass, e2e: e2eStatus };
  }
  const passDir = debugPassDir(deps.dataDir, runId, session.pass);
  const findingsPath = join26(passDir, "findings.json");
  const reportPath = join26(passDir, "findings.md");
  await writeJsonFile(findingsPath, { confirmedBlockers, base: session.base, pass: session.pass });
  const report = buildDebugReport({
    confirmedBlockers,
    passNumber: session.pass,
    base: session.base
  });
  await atomicWriteFile(reportPath, report.body);
  return {
    kind: "findings",
    run_id: runId,
    pass: session.pass,
    report_path: reportPath,
    confirmed_count: confirmedBlockers.length,
    e2e: e2eStatus
  };
}
function specDepsFor(deps, session) {
  if (session.confirmedBlockers === void 0) {
    return Promise.reject(
      new Error(
        `debug spec: run '${session.runId}' pass ${session.pass} has no recorded review \u2014 run 'debug review --record' first`
      )
    );
  }
  const report = buildDebugReport({
    confirmedBlockers: session.confirmedBlockers,
    passNumber: session.pass,
    base: session.base
  });
  return Promise.resolve(wireDebugSpecDeps(report, deps.dataDir));
}
async function debugRepo(deps) {
  return resolveRepo({ cwd: deps.cwd, gitClient: deps.gitClient });
}
async function debugSpecAction(deps, runId, fn) {
  const session = await readSession(deps.dataDir, runId);
  const repo = await debugRepo(deps);
  return fn(await specDepsFor(deps, session), repo, debugIssueNumber(session.pass), session);
}
async function debugSpecResolve(deps, runId) {
  return debugSpecAction(deps, runId, (d, repo, issue) => resolveSpec(d, repo, issue));
}
async function debugSpecGate(deps, runId) {
  return debugSpecAction(deps, runId, (d, repo, issue) => gateSpec(d, repo, issue));
}
async function debugSpecStore(deps, runId) {
  return debugSpecAction(deps, runId, async (d, repo, issue, session) => {
    const envelope = await storeSpec(d, repo, issue);
    if (envelope.kind === "stored") {
      await writeSession(deps.dataDir, { ...session, specId: envelope.pointer.spec_id });
    }
    return envelope;
  });
}
async function debugSeed(deps, runId) {
  const session = await readSession(deps.dataDir, runId);
  if (session.specId === void 0) {
    throw new Error(
      `debug seed: run '${runId}' pass ${session.pass} has no stored spec \u2014 run 'debug spec store' first`
    );
  }
  const repo = await debugRepo(deps);
  if (session.pass === 1) {
    await createRun(deps.state, deps.specStore, {
      repo,
      specId: session.specId,
      runId,
      debug: true,
      intent: "fresh",
      shipMode: session.noShip ? "no-merge" : "live",
      e2e: session.authorE2e,
      ...session.sessionId !== void 0 ? { ownerSession: session.sessionId } : {}
    });
  } else {
    const run9 = await deps.state.read(runId);
    const request = await deps.specStore.read(repo, session.specId);
    const merged = appendTasksFromSpec(run9.tasks, request, session.pass);
    await deps.state.update(runId, (s) => ({ ...s, tasks: merged }));
  }
  await writeSession(deps.dataDir, { ...session, pass: session.pass + 1 });
  return { kind: "loop", run_id: runId };
}
async function debugFinalize(deps, runId, shipMode) {
  if (!new StateManager({ dataDir: deps.dataDir }).exists(runId)) {
    return { kind: "nothing-to-ship", run_id: runId };
  }
  return finalizedEnvelope(deps.dataDir, runId, shipMode);
}
function wireDeps2(overrides = {}) {
  const hasDataDirOverride = overrides.dataDir !== void 0;
  const dataDir = resolveDataDir(hasDataDirOverride ? { dataDir: overrides.dataDir } : {});
  const config = loadConfig(hasDataDirOverride ? { dataDir } : {});
  return {
    gitClient: overrides.gitClient ?? new DefaultGitClient(),
    config,
    dataDir,
    cwd: overrides.cwd ?? process.cwd(),
    state: new StateManager({ dataDir }),
    specStore: new SpecStore({ dataDir })
  };
}
async function runDebugStart(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["full", "no-ship", "author-e2e"] });
  if (args.flag("help") === true) {
    return emitHelp(START_HELP);
  }
  const base = optionalString(args.flag("base"));
  const maxPassesRaw = optionalString(args.flag("max-passes"));
  const sessionId = resolveOwnerSession(args.flag("session-id"));
  const deps = wireDeps2(overrides);
  const envelope = await debugStart(deps, {
    full: args.flag("full") === true,
    ...base !== void 0 ? { base } : {},
    noShip: args.flag("no-ship") === true,
    authorE2e: args.flag("author-e2e") === true,
    ...maxPassesRaw !== void 0 ? { maxPasses: Number(maxPassesRaw) } : {},
    ...sessionId !== void 0 ? { sessionId } : {}
  });
  emitJson(envelope);
  return EXIT.OK;
}
async function runDebugReview(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["emit", "record"] });
  if (args.flag("help") === true) {
    return emitHelp(REVIEW_HELP);
  }
  const emit2 = args.flag("emit") === true;
  const record = args.flag("record") === true;
  if (emit2 === record) {
    throw new UsageError("debug review: pass exactly one of --emit or --record");
  }
  const runId = args.requireFlag("run");
  const deps = wireDeps2(overrides);
  if (emit2) {
    emitJson(await debugReviewEmit(deps, runId));
    return EXIT.OK;
  }
  const resultsPath = args.requireFlag("results");
  const input = await readJsonInput(resultsPath);
  emitJson(await debugReviewRecord(deps, runId, input));
  return EXIT.OK;
}
var SPEC_ACTIONS = {
  resolve: debugSpecResolve,
  gate: debugSpecGate,
  store: debugSpecStore
};
async function runDebugSpec(argv, overrides = {}) {
  const subAction = argv[0];
  if (subAction === void 0 || subAction === "--help" || subAction === "-h") {
    emitLine(SPEC_SUB_HELP);
    return EXIT.OK;
  }
  const handler = SPEC_ACTIONS[subAction];
  if (handler === void 0) {
    throw new UsageError(`unknown debug spec action '${subAction}' (expected resolve | gate | store)`);
  }
  const args = parseArgs(argv.slice(1), {});
  if (args.flag("help") === true) {
    return emitHelp(SPEC_SUB_HELP);
  }
  const runId = args.requireFlag("run");
  const deps = wireDeps2(overrides);
  emitJson(await handler(deps, runId));
  return EXIT.OK;
}
async function runDebugSeed(argv, overrides = {}) {
  const args = parseArgs(argv, {});
  if (args.flag("help") === true) {
    return emitHelp(SEED_HELP);
  }
  const runId = args.requireFlag("run");
  const deps = wireDeps2(overrides);
  emitJson(await debugSeed(deps, runId));
  return EXIT.OK;
}
async function runDebugFinalize(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["no-ship"] });
  if (args.flag("help") === true) {
    return emitHelp(FINALIZE_HELP2);
  }
  const runId = args.requireFlag("run");
  const shipMode = args.flag("no-ship") === true ? "no-merge" : void 0;
  const hasDataDirOverride = overrides.dataDir !== void 0;
  const dataDir = resolveDataDir(hasDataDirOverride ? { dataDir: overrides.dataDir } : {});
  emitJson(await debugFinalize({ dataDir }, runId, shipMode));
  return EXIT.OK;
}
var ACTIONS2 = {
  start: runDebugStart,
  review: runDebugReview,
  spec: runDebugSpec,
  seed: runDebugSeed,
  finalize: runDebugFinalize
};
async function run4(argv, overrides = {}) {
  const action = argv[0];
  if (action === void 0 || action === "--help" || action === "-h") {
    emitLine(DEBUG_HELP);
    return EXIT.OK;
  }
  const handler = ACTIONS2[action];
  if (handler === void 0) {
    throw new UsageError(`unknown debug action '${action}' (expected start | review | spec | seed | finalize)`);
  }
  return handler(argv.slice(1), overrides);
}
var debugCommand = {
  describe: "/factory:debug \u2014 whole-scope review\u21C4fix loop (start \u2192 review \u2192 spec \u2192 seed \u2192 \u2026 \u2192 finalize)",
  run: withUsageGuard("debug", run4)
};

// src/cli/subcommands/state.ts
var HELP2 = `factory state \u2014 read run state (read-only)

Usage:
  factory state                 Print the current run's state as JSON
  factory state <run-id>        Print a specific run's state as JSON
  factory state --summary       Print a compact human summary instead

Exit OK with {"current": null} when there is no current run.`;
function summarize2(run9) {
  const lines = [
    `run ${run9.run_id}  status=${run9.status}  execution_mode=${run9.execution_mode}` + (run9.status === "failed" || run9.status === "superseded" ? `  reason=${run9.terminal_reason ?? "reason unavailable"}` : ""),
    `spec ${run9.spec.repo}#${run9.spec.issue_number} (${run9.spec.spec_id})`,
    `tasks (${Object.keys(run9.tasks).length}):`
  ];
  for (const t of Object.values(run9.tasks)) {
    const bits = [`  ${t.task_id}`, t.status];
    if (t.escalation_rung > 0) {
      bits.push(`rung=${t.escalation_rung}`);
    }
    if (t.pr_number !== void 0) {
      bits.push(`pr=#${t.pr_number}`);
    }
    if (t.failure_class !== void 0) {
      bits.push(`class=${t.failure_class}`);
    }
    lines.push(bits.join("  "));
  }
  return lines.join("\n");
}
async function runState(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["summary"] });
  if (args.flag("help") === true) {
    return emitHelp(HELP2);
  }
  const state = new StateManager();
  const runId = args.positionals[0];
  const runState2 = runId !== void 0 ? await state.read(runId) : await readCurrentForCwd(state, overrides);
  if (runState2 === null) {
    if (args.flag("summary") === true) {
      emitLine("no current run");
    } else {
      emitJson({ current: null });
    }
    return EXIT.OK;
  }
  if (args.flag("summary") === true) {
    emitLine(summarize2(runState2));
  } else {
    emitJson(runState2);
  }
  return EXIT.OK;
}
var stateCommand = {
  describe: "Print run state (current or by run-id); read-only",
  run: withUsageGuard("state", runState)
};

// src/cli/subcommands/scaffold.ts
import { mkdir as mkdir14, readFile as readFile19, unlink as unlink3, writeFile as writeFile5 } from "node:fs/promises";
import { existsSync as existsSync11 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname12, join as join30, relative as relative2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/ci/inject-gate-env.ts
var SENTINEL = "# factory:gate-env";
function injectGateEnvIntoWorkflow(text, gateEnv) {
  const keys = Object.keys(gateEnv).sort();
  if (keys.length === 0) {
    return text;
  }
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim() === SENTINEL);
  if (idx === -1) {
    return text;
  }
  const indent = nonNull(/^[ \t]*/.exec(at(lines, idx)))[0];
  const block = [`${indent}env:`, ...keys.map((k) => `${indent}  ${k}: ${JSON.stringify(nonNull(gateEnv[k]))}`)];
  lines.splice(idx, 1, ...block);
  return lines.join("\n");
}

// src/ci/render-quality-gate.ts
var CI_RENDERED_GATES = ["type", "lint", "test", "build", "mutation"];
function ciBuiltins(run9, pm) {
  return {
    type: `${run9} tsc --noEmit`,
    lint: `${run9} eslint .`,
    test: `${run9} vitest run`,
    build: `${pm} run build`
  };
}
var SETUP_NODE = "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0";
var PNPM_SETUP = "pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8";
function nodeSetupInputs(runtime, cache) {
  return [
    "  with:",
    `      node-version-file: '${runtime.versionFile}'`,
    ...cache === void 0 ? [] : [`      cache: ${cache}`]
  ];
}
function replaceMarker(lines, marker, block) {
  const idx = lines.findIndex((l) => l.trim() === marker);
  if (idx === -1) {
    throw new Error(`renderQualityGate: template is missing the '${marker}' marker`);
  }
  const indentMatch = /^[ \t]*/.exec(lines[idx] ?? "");
  const indent = indentMatch ? indentMatch[0] : "";
  return [...lines.slice(0, idx), ...block.map((b) => b === "" ? "" : indent + b), ...lines.slice(idx + 1)];
}
function gateCommand(entry, builtin) {
  if (entry.contracted && entry.command !== void 0) {
    return entry.command;
  }
  return builtin;
}
function gateStep(id, opts, builtin) {
  const entry = opts.contract.gates[id];
  if (!entry.contracted) {
    return [`# ${id} gate uncontracted: ${entry.reason}`];
  }
  return [`- run: ${gateCommand(entry, builtin)}`];
}
function setupBlock(opts) {
  const extra = contractSetupSteps(opts.contract.setup_steps ?? []);
  if (opts.packageManager === "pnpm") {
    return [
      `- uses: ${PNPM_SETUP}`,
      `- uses: ${SETUP_NODE}`,
      ...nodeSetupInputs(opts.nodeRuntime, "pnpm"),
      "- run: pnpm install --frozen-lockfile",
      ...extra
    ];
  }
  if (opts.hasLockfile) {
    return [`- uses: ${SETUP_NODE}`, ...nodeSetupInputs(opts.nodeRuntime, "npm"), "- run: npm ci", ...extra];
  }
  return [
    `- uses: ${SETUP_NODE}`,
    ...nodeSetupInputs(opts.nodeRuntime),
    "- run: npm install --no-audit --no-fund",
    ...extra
  ];
}
function contractSetupSteps(steps, cond) {
  const lines = [];
  for (const step of steps) {
    if (step.uses !== void 0) {
      lines.push(...step.name === void 0 ? [] : [`- name: ${step.name}`]);
      lines.push(step.name === void 0 ? `- uses: ${step.uses}` : `  uses: ${step.uses}`);
      if (cond !== void 0) {
        lines.push(`  ${cond}`);
      }
      if (step.with !== void 0) {
        lines.push("  with:", ...Object.entries(step.with).map(([k, v]) => `      ${k}: ${v}`));
      }
    } else {
      const head = step.name === void 0 ? void 0 : `- name: ${step.name}`;
      if (head !== void 0) {
        lines.push(head, ...cond === void 0 ? [] : [`  ${cond}`], `  run: ${step.run ?? ""}`);
      } else if (cond !== void 0) {
        lines.push(`- ${cond}`, `  run: ${step.run ?? ""}`);
      } else {
        lines.push(`- run: ${step.run ?? ""}`);
      }
    }
  }
  return lines;
}
function gatesBlock(opts) {
  const pm = opts.packageManager;
  const lines = [];
  if (opts.hasNextDep) {
    lines.push(
      "- name: Generate Next.js type declarations",
      `  run: ${pm === "pnpm" ? "pnpm next typegen" : "npx next typegen"}`
    );
  }
  const run9 = pm === "pnpm" ? "pnpm exec" : "npx";
  const builtins = ciBuiltins(run9, pm);
  for (const id of CI_RENDERED_GATES) {
    if (id === "mutation") {
      continue;
    }
    const builtin = builtins[id];
    if (builtin === void 0) {
      throw new Error(`renderQualityGate: no builtin CI command for rendered gate '${id}'`);
    }
    lines.push(...gateStep(id, opts, builtin));
  }
  lines.push(
    "  # Build-time env for CI parity with the factory's local merge gate. Managed by",
    "  # the factory: `factory scaffold` replaces the marker below with a real `env:`",
    "  # block rendered from quality.gateEnv (set via `factory configure`). Placeholders",
    "  # only \u2014 real secrets stay in ${{ secrets.* }}. An empty gateEnv leaves the marker.",
    "  # factory:gate-env"
  );
  if (opts.scripts["deps:validate"] !== void 0) {
    lines.push(`- run: ${pm === "pnpm" ? "pnpm deps:validate" : "npm run deps:validate"}`);
  }
  if (pm === "pnpm") {
    lines.push(
      "- name: pnpm audit (non-blocking; pnpm legacy endpoint 410, Snyk covers vulns)",
      "  run: pnpm audit --audit-level=high",
      "  continue-on-error: true"
    );
  } else {
    lines.push(
      "- name: npm audit (non-blocking)",
      "  run: npm audit --audit-level=high",
      "  continue-on-error: true"
    );
  }
  return lines;
}
function mutationSetupBlock(opts) {
  const cond = "if: steps.slice.outputs.slice != ''";
  const extra = contractSetupSteps(opts.contract.setup_steps ?? [], cond);
  if (opts.packageManager === "pnpm") {
    return [
      `- uses: ${PNPM_SETUP}`,
      `  ${cond}`,
      `- uses: ${SETUP_NODE}`,
      `  ${cond}`,
      ...nodeSetupInputs(opts.nodeRuntime, "pnpm"),
      `- ${cond}`,
      "  run: pnpm install --frozen-lockfile",
      ...extra
    ];
  }
  if (opts.hasLockfile) {
    return [
      `- uses: ${SETUP_NODE}`,
      `  ${cond}`,
      ...nodeSetupInputs(opts.nodeRuntime, "npm"),
      `- ${cond}`,
      "  run: npm ci",
      ...extra
    ];
  }
  return [
    `- uses: ${SETUP_NODE}`,
    `  ${cond}`,
    ...nodeSetupInputs(opts.nodeRuntime),
    `- ${cond}`,
    "  run: npm install --no-audit --no-fund",
    ...extra
  ];
}
function waivedMutationBlock(reason) {
  const quoted = reason.replace(/'/g, "''");
  return [
    `# Mutation testing is waived in this repo's gate contract: ${reason}.`,
    '# The aggregator job is kept so the required status check "Mutation Testing"',
    "# stays a universal context across factory repos; it reports green without",
    "# running any mutants.",
    "mutation-testing:",
    "  name: Mutation Testing",
    "  runs-on: ubuntu-latest",
    "  needs: quality",
    "  steps:",
    `    - run: echo 'Mutation testing waived (gate contract): ${quoted}'`
  ];
}
var DEFAULT_ROOTS_PATHSPEC = "'src/**/*.ts'";
var MUTABLE_SOURCE_EXCLUDE = String.raw`\.(test|spec|d)\.ts$|/types/|/data/|/index\.ts$|src/app/(robots|sitemap)\.ts`;
function applyMutableSourceExclude(lines) {
  let matches = 0;
  const out = lines.map((l) => {
    if (!l.includes("grep -Ev")) {
      return l;
    }
    matches++;
    return l.replace(/grep -Ev '[^']*'/, `grep -Ev '${MUTABLE_SOURCE_EXCLUDE}'`);
  });
  if (matches === 0) {
    throw new Error(
      "renderQualityGate: template has no `grep -Ev` mutable-source exclude line \u2014 the anchor the single-predicate replacement (S11) targets is gone"
    );
  }
  return out;
}
function rootsPathspec(roots) {
  return roots.map((r) => `'${r}/**/*.ts'`).join(" ");
}
function applyMutationRoots(lines, contract) {
  const roots = mutationRoots(contract);
  const spec = rootsPathspec(roots);
  if (spec === DEFAULT_ROOTS_PATHSPEC) {
    return lines;
  }
  let matches = 0;
  const out = lines.map((l) => {
    if (!l.includes(DEFAULT_ROOTS_PATHSPEC)) {
      return l;
    }
    matches++;
    return l.replace(DEFAULT_ROOTS_PATHSPEC, spec);
  });
  if (matches === 0) {
    throw new Error(
      `renderQualityGate: contract mutation roots need re-pointing but the template has no ${DEFAULT_ROOTS_PATHSPEC} default-roots pathspec to replace`
    );
  }
  return out;
}
function renderMutationRegion(lines, opts) {
  const begin = lines.findIndex((l) => l.trim() === "# factory:mutation-begin");
  const end = lines.findIndex((l) => l.trim() === "# factory:mutation-end");
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error("renderQualityGate: template is missing the '# factory:mutation-begin/end' region");
  }
  const mutation = opts.contract.gates.mutation;
  if (!mutation.contracted) {
    const indentMatch = /^[ \t]*/.exec(lines[begin] ?? "");
    const indent = indentMatch ? indentMatch[0] : "";
    const block = waivedMutationBlock(mutation.reason).map((b) => b === "" ? "" : indent + b);
    return [...lines.slice(0, begin), ...block, ...lines.slice(end + 1)];
  }
  let kept = [...lines.slice(0, begin), ...lines.slice(begin + 1, end), ...lines.slice(end + 1)];
  kept = replaceMarker(kept, "# factory:mutation-setup", mutationSetupBlock(opts));
  kept = applyMutationRoots(kept, opts.contract);
  kept = applyMutableSourceExclude(kept);
  if (opts.packageManager === "npm") {
    kept = kept.map((l) => l.replace("pnpm exec stryker run \\", "npx stryker run \\"));
  }
  return kept;
}
function renderMutationNightly(template, opts) {
  if (opts.contract.stack !== "npm") {
    throw new Error(
      `renderMutationNightly: stack '${opts.contract.stack}' is not supported \u2014 the CI quality gate renders for npm-stack repos only (deno/custom repos rely on the local GateRunner)`
    );
  }
  if (!opts.contract.gates.mutation.contracted) {
    return null;
  }
  let lines = template.split("\n");
  lines = replaceMarker(lines, "# factory:mutation-setup", mutationSetupBlock(opts));
  lines = applyMutationRoots(lines, opts.contract);
  lines = applyMutableSourceExclude(lines);
  if (opts.packageManager === "npm") {
    lines = lines.map((l) => l.replace("pnpm exec stryker run \\", "npx stryker run \\"));
  }
  return lines.join("\n");
}
function renderQualityGate(template, opts) {
  if (opts.contract.stack !== "npm") {
    throw new Error(
      `renderQualityGate: stack '${opts.contract.stack}' is not supported \u2014 the CI quality gate renders for npm-stack repos only (deno/custom repos rely on the local GateRunner)`
    );
  }
  let lines = template.split("\n");
  lines = replaceMarker(lines, "# factory:setup", setupBlock(opts));
  lines = replaceMarker(lines, "# factory:gates", gatesBlock(opts));
  lines = renderMutationRegion(lines, opts);
  return lines.join("\n");
}

// src/ci/node-runtime.ts
var NODE_VERSION_FILE = ".node-version";
var NVMRC_FILE = ".nvmrc";
var PACKAGE_JSON_FILE = "package.json";
function normalizeVersionFile(name, raw) {
  const value = raw.trim();
  if (value.length === 0) {
    throw new Error(`scaffold: ${name} must contain a non-empty Node version`);
  }
  if (/\r|\n/.test(value)) {
    throw new Error(`scaffold: ${name} must contain exactly one Node version line`);
  }
  return value;
}
function resolveNodeRuntimeDeclarations(declarations) {
  const nodeVersion = declarations.nodeVersion === void 0 ? void 0 : normalizeVersionFile(NODE_VERSION_FILE, declarations.nodeVersion);
  const nvmrc = declarations.nvmrc === void 0 ? void 0 : normalizeVersionFile(NVMRC_FILE, declarations.nvmrc);
  if (Object.hasOwn(declarations, "enginesNode")) {
    if (typeof declarations.enginesNode !== "string" || declarations.enginesNode.trim().length === 0) {
      throw new Error("scaffold: package.json engines.node must be a non-empty string");
    }
  }
  if (nodeVersion !== void 0 && nvmrc !== void 0 && nodeVersion !== nvmrc) {
    throw new Error(
      `scaffold: ${NODE_VERSION_FILE} (${nodeVersion}) and ${NVMRC_FILE} (${nvmrc}) disagree; keep one source or make them identical`
    );
  }
  if (nodeVersion !== void 0) {
    return { versionFile: NODE_VERSION_FILE };
  }
  if (nvmrc !== void 0) {
    return { versionFile: NVMRC_FILE };
  }
  if (Object.hasOwn(declarations, "enginesNode")) {
    if ((declarations.packageJsonRuntimeShadows?.length ?? 0) > 0) {
      throw new Error(
        `scaffold: package.json engines.node is shadowed by ${declarations.packageJsonRuntimeShadows?.join(", ")}; remove the shadowing field or declare .node-version/.nvmrc`
      );
    }
    return { versionFile: PACKAGE_JSON_FILE };
  }
  throw new Error(
    `scaffold: Node runtime is undeclared; add ${NODE_VERSION_FILE}, ${NVMRC_FILE}, or package.json engines.node`
  );
}

// src/cli/subcommands/target-settings.ts
import { mkdir as mkdir11, readFile as readFile16 } from "node:fs/promises";
import { existsSync as existsSync8 } from "node:fs";
import { join as join27 } from "node:path";
var log35 = createLogger("cli:target-settings");
var FACTORY_TARGET_BASE_ALLOWLIST = [
  "Bash(factory:*)",
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Agent"
];
var DATA_DIR_VERBS = ["Read", "Edit"];
var DEAD_WRITE_RULE = /^Write\(.+\)$/;
function buildTargetDataDirRules(opts) {
  return {
    allowGlobBase: tildeShorten(opts.dataDir, opts.home),
    additionalDir: opts.dataDir
  };
}
function dataDirAllowRules(allowGlobBase) {
  return DATA_DIR_VERBS.map((verb) => `${verb}(${allowGlobBase}/**)`);
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function mergeTargetSettings(existing, dataDirRules) {
  const settings = structuredClone(existing);
  let changed = false;
  const permissions = isObject(settings.permissions) ? settings.permissions : {};
  const currentAllow = Array.isArray(permissions.allow) ? permissions.allow.filter((e) => typeof e === "string") : [];
  const keptAllow = currentAllow.filter((e) => !DEAD_WRITE_RULE.test(e));
  const targetAllow = [...FACTORY_TARGET_BASE_ALLOWLIST, ...dataDirAllowRules(dataDirRules.allowGlobBase)];
  const have = new Set(keptAllow);
  const additions = targetAllow.filter((e) => !have.has(e));
  if (additions.length > 0 || keptAllow.length !== currentAllow.length) {
    permissions.allow = [...keptAllow, ...additions];
    settings.permissions = permissions;
    changed = true;
  }
  const worktree = isObject(settings.worktree) ? settings.worktree : {};
  if (worktree.baseRef !== "head") {
    worktree.baseRef = "head";
    settings.worktree = worktree;
    changed = true;
  }
  return { settings, changed };
}
function staleLocalDirs(dataDirRules) {
  return /* @__PURE__ */ new Set(["${CLAUDE_PLUGIN_DATA}", dataDirRules.allowGlobBase, dataDirRules.additionalDir]);
}
function mergeLocalSettings(existing, dataDirRules) {
  const settings = structuredClone(existing);
  const permissions = isObject(settings.permissions) ? settings.permissions : {};
  const currentDirs = Array.isArray(permissions.additionalDirectories) ? permissions.additionalDirectories.filter((e) => typeof e === "string") : [];
  const stale = staleLocalDirs(dataDirRules);
  const nextDirs = [...currentDirs.filter((e) => !stale.has(e)), dataDirRules.additionalDir];
  const changed = JSON.stringify(nextDirs) !== JSON.stringify(currentDirs);
  if (changed) {
    permissions.additionalDirectories = nextDirs;
    settings.permissions = permissions;
  }
  return { settings, changed };
}
async function readExistingSettings(path7) {
  if (!existsSync8(path7)) {
    return {};
  }
  const raw = await readFile16(path7, "utf8");
  const parsed = raw.trim().length > 0 ? JSON.parse(raw) : {};
  if (isObject(parsed)) {
    return parsed;
  }
  log35.warn(
    `${path7} is valid JSON but not an object (${Array.isArray(parsed) ? "array" : typeof parsed}); replacing it with the factory settings object`
  );
  return {};
}
async function ensureTargetSettings(opts) {
  const dir = join27(opts.targetRoot, ".claude");
  const path7 = join27(dir, "settings.json");
  const localPath = join27(dir, "settings.local.json");
  const created = !existsSync8(path7);
  const localCreated = !existsSync8(localPath);
  const [existing, existingLocal] = await Promise.all([readExistingSettings(path7), readExistingSettings(localPath)]);
  const { settings, changed } = mergeTargetSettings(existing, opts.dataDirRules);
  const { settings: localSettings, changed: localChanged } = mergeLocalSettings(existingLocal, opts.dataDirRules);
  if (created || changed || localCreated || localChanged) {
    await mkdir11(dir, { recursive: true });
  }
  if (created || changed) {
    await atomicWriteFile(path7, stringifyJson(settings));
  }
  if (localCreated || localChanged) {
    await atomicWriteFile(localPath, stringifyJson(localSettings));
  }
  return {
    settings,
    changed,
    created,
    path: path7,
    local: { settings: localSettings, changed: localChanged, created: localCreated, path: localPath }
  };
}

// src/cli/subcommands/scaffold-gates.ts
import { existsSync as existsSync9, readdirSync, statSync } from "node:fs";
import { mkdir as mkdir12, readFile as readFile17, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname10, join as join28 } from "node:path";
function detectStack(targetRoot) {
  const has = (f) => existsSync9(join28(targetRoot, f));
  const hasPkg = has("package.json");
  const hasDeno = has("deno.json") || has("deno.jsonc");
  const hasNodeLock = has("pnpm-lock.yaml") || has("package-lock.json") || has("yarn.lock") || has("bun.lockb");
  if (hasPkg && hasNodeLock) {
    return "npm";
  }
  if (hasDeno) {
    return "deno";
  }
  if (hasPkg) {
    return "npm";
  }
  return "custom";
}
async function readPackageJson(targetRoot) {
  const raw = await readFile17(join28(targetRoot, "package.json"), "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`scaffold: package.json is not valid JSON: ${err.message}`);
  }
}
function hasDep(pkg, name) {
  return pkg.dependencies?.[name] !== void 0 || pkg.devDependencies?.[name] !== void 0;
}
function stripJsoncComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
async function denoHasBuildTask(targetRoot) {
  const jsonc = existsSync9(join28(targetRoot, "deno.jsonc"));
  const file = jsonc ? "deno.jsonc" : "deno.json";
  const raw = await readFile17(join28(targetRoot, file), "utf8");
  let parsed;
  try {
    parsed = JSON.parse(jsonc ? stripJsoncComments(raw) : raw);
  } catch (err) {
    throw new Error(`scaffold: ${file} is not parseable JSON: ${err.message}`);
  }
  const tasks = parsed.tasks;
  return typeof tasks?.build === "string";
}
var yes = { contracted: true };
var no = (reason) => ({ contracted: false, reason });
var MUTATION_ROOT_CANDIDATES = [
  "app",
  "components",
  "lib",
  "utils",
  "db",
  "server",
  "hooks"
];
function hasMutableTs(targetRoot, root) {
  const abs = join28(targetRoot, root);
  if (!existsSync9(abs) || !statSync(abs).isDirectory()) {
    return false;
  }
  const entries = readdirSync(abs, { recursive: true, encoding: "utf8" });
  return entries.some((rel) => isMutableSrc(`${root}/${rel.replaceAll("\\", "/")}`, [root]));
}
function detectMutationRoots(targetRoot) {
  if (hasMutableTs(targetRoot, "src")) {
    return void 0;
  }
  const roots = MUTATION_ROOT_CANDIDATES.filter((r) => hasMutableTs(targetRoot, r));
  return roots.length > 0 ? roots : [];
}
async function resolveNpm(opts) {
  const pkg = await readPackageJson(opts.targetRoot);
  const floor = [];
  if (!hasDep(pkg, "vitest")) {
    floor.push("test gate: no vitest dependency \u2014 install vitest");
  }
  if (!existsSync9(join28(opts.targetRoot, "tsconfig.json"))) {
    floor.push("type gate: no tsconfig.json \u2014 add one");
  }
  if (pkg.scripts?.build === void 0) {
    floor.push("build gate: no scripts.build \u2014 add a build script");
  }
  if (floor.length > 0) {
    throw new Error(`scaffold: gate contract below floor for stack 'npm':
  - ${floor.join("\n  - ")}`);
  }
  const strykerResolvable = hasDep(pkg, "@stryker-mutator/core") || existsSync9(join28(opts.targetRoot, "node_modules", ".bin", "stryker"));
  let mutation;
  if (opts.waiveMutation) {
    mutation = no("waived via --waive mutation");
  } else if (strykerResolvable) {
    const roots = detectMutationRoots(opts.targetRoot);
    if (roots?.length === 0) {
      throw new Error(
        `scaffold: mutation gate: no mutable-source roots found \u2014 no src/ and none of ${MUTATION_ROOT_CANDIDATES.join("/")} contain mutable .ts files. Contracting mutation would make the "Mutation Testing" check a silent no-op; add explicit roots to .factory/gates.json (gates.mutation.roots) or pass --waive mutation`
      );
    }
    mutation = roots === void 0 ? yes : { contracted: true, roots: [...roots] };
  } else {
    throw new Error(
      "scaffold: mutation gate: stryker not installed \u2014 install @stryker-mutator/core or pass --waive mutation to record the waiver"
    );
  }
  const coverageProvider = hasDep(pkg, "@vitest/coverage-v8") || hasDep(pkg, "@vitest/coverage-istanbul");
  let coverage;
  if (coverageProvider) {
    coverage = yes;
  } else if (opts.waiveCoverage) {
    coverage = no("waived via --waive coverage");
  } else {
    throw new Error(
      "scaffold: coverage gate: no vitest coverage provider \u2014 install @vitest/coverage-v8 (or @vitest/coverage-istanbul) or pass --waive coverage to record the waiver"
    );
  }
  const eslintConfig = ESLINT_CONFIGS.some(
    (c) => existsSync9(join28(opts.targetRoot, c)) || opts.projectedSeedFiles?.includes(c) === true
  );
  let lint;
  if (!eslintConfig) {
    lint = no("no eslint config");
  } else if (hasDep(pkg, "eslint") || existsSync9(join28(opts.targetRoot, "node_modules", ".bin", "eslint"))) {
    lint = yes;
  } else {
    lint = no("eslint config present but eslint not installed \u2014 install eslint and re-scaffold");
  }
  return {
    version: 1,
    stack: "npm",
    gates: {
      test: yes,
      tdd: yes,
      coverage,
      mutation,
      sast: opts.securityCommand != null && opts.securityCommand.length > 0 ? yes : no("no quality.securityCommand configured"),
      type: yes,
      lint,
      build: yes
    }
  };
}
async function resolveDeno(opts) {
  const build = await denoHasBuildTask(opts.targetRoot) ? { contracted: true, command: "deno task build" } : no("waived-by-stack: no emit step \u2014 deno check covers compilation");
  return {
    version: 1,
    stack: "deno",
    gates: {
      test: { contracted: true, command: "deno test" },
      tdd: yes,
      coverage: no(
        "waived-by-stack: deno coverage emits lcov, no json-summary \u2014 contract a coverage command that writes coverage/coverage-summary.json or keep waived"
      ),
      mutation: no("waived-by-stack: stryker does not support deno"),
      sast: opts.securityCommand != null && opts.securityCommand.length > 0 ? yes : no("no quality.securityCommand configured"),
      type: { contracted: true, command: "deno check ." },
      lint: { contracted: true, command: "deno lint" },
      build
    }
  };
}
async function resolveGateContract(opts) {
  const stack = detectStack(opts.targetRoot);
  if (stack === "custom") {
    throw new Error(
      "scaffold: gate contract floor unsatisfiable for stack 'custom' \u2014 no package.json (npm) or deno.json/deno.jsonc (deno) detected; the factory requires contractable test + type + build gates"
    );
  }
  const contract = stack === "npm" ? await resolveNpm(opts) : await resolveDeno(opts);
  return GateContractSchema.parse(contract);
}
async function recommendFastCheck(targetRoot) {
  if (detectStack(targetRoot) !== "npm") {
    return false;
  }
  return !hasDep(await readPackageJson(targetRoot), "fast-check");
}
var invalidContractError = (error) => new Error(`scaffold: ${GATE_CONTRACT_REL} is INVALID (${error}) \u2014 fix it or delete it and re-run factory scaffold`);
async function preflightGateContract(opts) {
  const load = await loadGateContract(opts.targetRoot);
  if (load.state === "invalid") {
    throw invalidContractError(load.error);
  }
  if (load.state === "ok") {
    return load.contract;
  }
  return resolveGateContract(opts);
}
async function ensureGateContract(opts) {
  const load = await loadGateContract(opts.targetRoot);
  if (load.state === "invalid") {
    throw invalidContractError(load.error);
  }
  if (load.state === "ok") {
    return { status: "present", stack: load.contract.stack, contract: load.contract };
  }
  const contract = await resolveGateContract(opts);
  const dest = join28(opts.targetRoot, GATE_CONTRACT_REL);
  await mkdir12(dirname10(dest), { recursive: true });
  await writeFile3(dest, JSON.stringify(contract, null, 2) + "\n", "utf8");
  return { status: "created", stack: contract.stack, contract };
}

// src/cli/subcommands/scaffold-lock.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdir as mkdir13, readFile as readFile18, writeFile as writeFile4 } from "node:fs/promises";
import { existsSync as existsSync10 } from "node:fs";
import { dirname as dirname11, join as join29 } from "node:path";
var SCAFFOLD_LOCK_REL = ".factory/scaffold.lock";
function sha256Hex(text) {
  return createHash2("sha256").update(text, "utf8").digest("hex");
}
async function loadScaffoldLock(targetRoot) {
  const path7 = join29(targetRoot, SCAFFOLD_LOCK_REL);
  const empty = { version: 1, seeds: {}, managed: {} };
  if (!existsSync10(path7)) {
    return { lock: empty, existed: false, invalid: false };
  }
  try {
    const parsed = JSON.parse(await readFile18(path7, "utf8"));
    const version = typeof parsed === "object" && parsed !== null ? parsed.version : null;
    if (typeof version === "number" && version !== 1) {
      throw new UnsupportedLockVersionError(version);
    }
    const seeds = typeof parsed === "object" && parsed !== null ? parsed.seeds : null;
    if (typeof seeds !== "object" || seeds === null) {
      return { lock: empty, existed: true, invalid: true };
    }
    const readMap = (value) => {
      const valid = {};
      if (typeof value === "object" && value !== null) {
        for (const [rel, hash] of Object.entries(value)) {
          if (typeof hash === "string") {
            valid[rel] = hash;
          }
        }
      }
      return valid;
    };
    const managed = parsed.managed;
    return { lock: { version: 1, seeds: readMap(seeds), managed: readMap(managed) }, existed: true, invalid: false };
  } catch (err) {
    if (err instanceof UnsupportedLockVersionError) {
      throw err;
    }
    return { lock: empty, existed: true, invalid: true };
  }
}
var UnsupportedLockVersionError = class extends Error {
  constructor(version) {
    super(
      `scaffold: ${SCAFFOLD_LOCK_REL} declares version ${version}, but this engine supports only version 1 \u2014 upgrade the factory plugin (or delete the lock to re-adopt seeds). Nothing was written.`
    );
    this.name = "UnsupportedLockVersionError";
  }
};
async function saveScaffoldLock(targetRoot, lock2) {
  const path7 = join29(targetRoot, SCAFFOLD_LOCK_REL);
  const sorted = (map) => {
    const out = {};
    for (const [rel, hash] of Object.entries(map).sort(([a], [b]) => a.localeCompare(b))) {
      out[rel] = hash;
    }
    return out;
  };
  await mkdir13(dirname11(path7), { recursive: true });
  await writeFile4(
    path7,
    JSON.stringify({ version: 1, seeds: sorted(lock2.seeds), managed: sorted(lock2.managed) }, null, 2) + "\n",
    "utf8"
  );
}

// src/cli/subcommands/scaffold.ts
var log36 = createLogger("scaffold");
var HELP3 = `factory scaffold \u2014 prepare a repo for the factory pipeline

Usage:
  factory scaffold [--repo <owner/name>] [--provision] [--waive mutation|coverage] [--force-managed]

Copies the committed CI + gate-config templates and probes branch protection on
develop (the integration base). Default mode (git.developProtection=run-scoped, D74):
an UNPROTECTED develop causes scaffold to REFUSE loudly; --provision writes the light
BASELINE profile (git.developBaselineStatusChecks required for non-admins, strict off,
admins push freely) \u2014 the strict CI profile is escalated per-run at run create and
dropped when the run ends. Under git.developProtection=permanent the strict profile
(strict up-to-date + git.developRequiredStatusChecks) is asserted/provisioned instead
and never removed. Per-run staging branches are minted at run create \u2014 scaffold no
longer touches them. The managed quality-gate.yml is rendered with the configured
quality.gateEnv (set via 'factory configure --set quality.gateEnv.<KEY>=<value>').

Options:
  --repo <owner/name>   OPTIONAL. Target GitHub repo (used for the protection probe).
                        Auto-derived from the 'origin' remote when omitted; an
                        explicit value disagreeing with the remote fails loud.
  --provision           Write branch protection if missing (default: refuse). In
                        run-scoped mode the PUT always writes the BASELINE profile \u2014
                        re-running it is also the one-shot migration off the old
                        permanent strict profile (refused while a run is active).
  --waive mutation      Record the mutation gate as deliberately waived in the gate
                        contract instead of refusing when stryker is not installed
  --waive coverage      Record the coverage gate as deliberately waived instead of
                        refusing when no vitest coverage provider is installed
  --force-managed       Re-adopt conflicted MANAGED files: overwrite a customized
                        managed file with the plugin template and re-record its
                        hash (default: a customized managed file is a
                        files_conflict refusal with zero writes). Never
                        authorizes DELETING a customized stale nightly \u2014
                        force only overwrites toward the shipped template

Also resolves + writes the GATE CONTRACT (.factory/gates.json, Decision 46): the
committed per-gate applicability agreement. Refuses below the floor (test + type +
build equivalents must be contractable). COMMIT the file \u2014 'factory run' requires
it tracked. The contract is seed-like: an existing valid gates.json is never
touched \u2014 delete it and re-scaffold to pick up new resolution rules (e.g. the
S8 coverage flip).

Re-scaffold refreshes OUTDATED files fail-safe: managed files (the CI net) only
when provably PRISTINE (bytes match the committed .factory/scaffold.lock managed
hash, or the new render) \u2014 a customized managed file is a files_conflict refusal
with ZERO writes unless --force-managed re-adopts it; seed configs refresh ONLY
while pristine per the lock's seed hashes. A customized seed is project-owned and
never overwritten; delete it and re-scaffold to re-adopt the latest baseline.`;
var GITIGNORE_ENTRIES = [
  "# Claude Code local state (factory scaffold guarantee)",
  ".claude/worktrees/",
  ".claude/plugins/",
  ".claude/file-history/",
  ".claude/backups/",
  ".claude/debug/",
  ".claude/todos/",
  ".claude/plans/",
  ".claude/memory/",
  ".claude/statsig/",
  ".claude/cache/",
  ".claude/paste-cache/",
  ".claude/projects/",
  ".claude/shell-snapshots/",
  ".claude/tasks/",
  ".claude/telemetry/",
  ".claude/workflows/",
  ".claude/history.jsonl",
  ".claude/CLAUDE.local.md",
  ".claude/settings.local.json",
  "# factory plugin state",
  ".claude-plugin-data/",
  "*.worktree"
];
function resolveTemplatesDir() {
  let dir = dirname12(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join30(dir, "templates");
    if (existsSync11(join30(candidate, ".github", "workflows", "quality-gate.yml"))) {
      return candidate;
    }
    const parent = dirname12(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error("scaffold: could not locate the plugin templates/ directory");
}
var QUALITY_GATE_REL = ".github/workflows/quality-gate.yml";
var LEGACY_E2E_EXAMPLE_HASHES = [
  "2fcc468328b2070bd07ede3e524bf1bf33ec2957d2d0e9bef29302251a24356d",
  "629824a48477223cfcef02bcb6c850aa9622d73d41c93bc3b76486831a98770e"
];
var MUTATION_NIGHTLY_REL = ".github/workflows/mutation-nightly.yml";
var STRYKER_SEED_REL = ".stryker.config.json";
var CI_NET_RELS = [
  QUALITY_GATE_REL,
  ".github/scripts/shard-mutation-scope.mjs",
  MUTATION_NIGHTLY_REL
];
var TEMPLATE_MANIFEST = [
  { rel: QUALITY_GATE_REL, policy: "managed" },
  { rel: ".github/scripts/shard-mutation-scope.mjs", policy: "managed" },
  { rel: MUTATION_NIGHTLY_REL, policy: "managed" },
  { rel: STRYKER_SEED_REL, policy: "seed", nodeOnly: true },
  { rel: ".dependency-cruiser.cjs", policy: "seed", nodeOnly: true },
  { rel: "eslint.config.mjs", policy: "seed", nodeOnly: true },
  // e2e (Decision 39) — seed only; @playwright/test must already be a devDependency
  // (scaffold never installs packages) and the config's webServer.command is a TODO
  // the project fills in. testDir here MUST match the engine's fixed E2E_TEST_DIR ("e2e") —
  // and must STAY "./e2e" in any template edit: pristine auto-refresh propagates
  // template changes into already-scaffolded repos, and S4 assertE2ePrereqs
  // refuses an --e2e run whose config declares any other testDir.
  { rel: "playwright.config.ts", policy: "seed", nodeOnly: true },
  {
    rel: "e2e/example.spec.ts",
    policy: "seed",
    nodeOnly: true,
    legacySeedHashes: LEGACY_E2E_EXAMPLE_HASHES
  }
];
async function applyTemplate(entry, templatesDir, targetRoot, lists, lock2, transform) {
  const segs = entry.rel.split("/");
  const src = join30(templatesDir, ...segs);
  const dest = join30(targetRoot, ...segs);
  if (!existsSync11(src)) {
    log36.warn(`template missing, skipping: ${src}`);
    return;
  }
  const render = async () => {
    const text = await readFile19(src, "utf8");
    return transform ? transform(text) : text;
  };
  if (!existsSync11(dest)) {
    const rendered2 = await render();
    await mkdir14(dirname12(dest), { recursive: true });
    await writeFile5(dest, rendered2, "utf8");
    if (lock2) {
      const map = entry.policy === "seed" ? lock2.seeds : lock2.managed;
      map[entry.rel] = sha256Hex(rendered2);
      lock2.dirty = true;
    }
    lists.created.push(entry.rel);
    return;
  }
  if (entry.policy === "seed") {
    const recorded = lock2?.seeds[entry.rel];
    const destText2 = await readFile19(dest, "utf8");
    const destHash = sha256Hex(destText2);
    if (recorded !== void 0) {
      if (destHash === recorded) {
        const rendered2 = await render();
        if (rendered2 === destText2) {
          lists.present.push(entry.rel);
          return;
        }
        await writeFile5(dest, rendered2, "utf8");
        if (lock2) {
          lock2.seeds[entry.rel] = sha256Hex(rendered2);
          lock2.dirty = true;
        }
        lists.updated.push(entry.rel);
        return;
      }
    }
    if (lock2 !== void 0 && entry.legacySeedHashes?.includes(destHash) === true) {
      const rendered2 = await render();
      if (rendered2 !== destText2) {
        await writeFile5(dest, rendered2, "utf8");
        lists.updated.push(entry.rel);
      } else {
        lists.present.push(entry.rel);
      }
      lock2.seeds[entry.rel] = sha256Hex(rendered2);
      lock2.dirty = true;
      return;
    }
    lists.present.push(entry.rel);
    return;
  }
  const [rendered, destText] = await Promise.all([render(), readFile19(dest, "utf8")]);
  const renderedHash = sha256Hex(rendered);
  if (lock2 && lock2.managed[entry.rel] !== renderedHash) {
    lock2.managed[entry.rel] = renderedHash;
    lock2.dirty = true;
  }
  if (rendered === destText) {
    lists.present.push(entry.rel);
    return;
  }
  await writeFile5(dest, rendered, "utf8");
  lists.updated.push(entry.rel);
}
async function readWorkflowFacts(targetRoot) {
  const pnpm = existsSync11(join30(targetRoot, "pnpm-lock.yaml"));
  const raw = await readFile19(join30(targetRoot, "package.json"), "utf8");
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`scaffold: package.json is not valid JSON: ${err.message}`);
  }
  const declarations = {};
  if (existsSync11(join30(targetRoot, NODE_VERSION_FILE))) {
    declarations.nodeVersion = await readFile19(join30(targetRoot, NODE_VERSION_FILE), "utf8");
  }
  if (existsSync11(join30(targetRoot, NVMRC_FILE))) {
    declarations.nvmrc = await readFile19(join30(targetRoot, NVMRC_FILE), "utf8");
  }
  if (typeof pkg.engines === "object" && pkg.engines !== null && Object.hasOwn(pkg.engines, "node")) {
    declarations.enginesNode = pkg.engines.node;
  }
  const packageJsonRuntimeShadows = [];
  if (typeof pkg.volta === "object" && pkg.volta !== null) {
    if (Object.hasOwn(pkg.volta, "node")) {
      packageJsonRuntimeShadows.push("volta.node");
    }
    if (Object.hasOwn(pkg.volta, "extends")) {
      packageJsonRuntimeShadows.push("volta.extends");
    }
  }
  if (typeof pkg.devEngines === "object" && pkg.devEngines !== null && Object.hasOwn(pkg.devEngines, "runtime")) {
    packageJsonRuntimeShadows.push("devEngines.runtime");
  }
  declarations.packageJsonRuntimeShadows = packageJsonRuntimeShadows;
  return {
    packageManager: pnpm ? "pnpm" : "npm",
    hasLockfile: pnpm || existsSync11(join30(targetRoot, "package-lock.json")),
    scripts: pkg.scripts ?? {},
    hasNextDep: pkg.dependencies?.next !== void 0 || pkg.devDependencies?.next !== void 0,
    nodeRuntime: resolveNodeRuntimeDeclarations(declarations)
  };
}
async function ensureIgnoreFile(root, filename, entries, lists) {
  const path7 = join30(root, filename);
  const rel = relative2(root, path7);
  if (!existsSync11(path7)) {
    await writeFile5(path7, entries.join("\n") + "\n", "utf8");
    lists.created.push(rel);
    return;
  }
  const current = await readFile19(path7, "utf8");
  const missing = entries.filter((e) => !current.split("\n").includes(e));
  if (missing.length === 0) {
    lists.present.push(rel);
    return;
  }
  const sep4 = current.endsWith("\n") ? "" : "\n";
  await writeFile5(path7, current + sep4 + missing.join("\n") + "\n", "utf8");
  lists.present.push(rel);
}
async function ensureGitignore(root, lists) {
  await ensureIgnoreFile(root, ".gitignore", GITIGNORE_ENTRIES, lists);
}
var PRETTIERIGNORE_ENTRIES = [
  "# factory plugin: generated bundle (esbuild output, not hand-formatted)",
  ".github/scripts/"
];
async function ensurePrettierignore(root, lists) {
  await ensureIgnoreFile(root, ".prettierignore", PRETTIERIGNORE_ENTRIES, lists);
}
function managedTransform(rel, contract, facts, gateEnv) {
  if (rel === QUALITY_GATE_REL) {
    return (text) => injectGateEnvIntoWorkflow(renderQualityGate(text, { contract, ...facts }), gateEnv);
  }
  if (rel === MUTATION_NIGHTLY_REL) {
    return (text) => nonNull(renderMutationNightly(text, { contract, ...facts }));
  }
  return void 0;
}
async function preflightManagedFiles(opts, lock2, contract) {
  if (contract.stack !== "npm") {
    return { staleNightlyHash: void 0 };
  }
  const facts = await readWorkflowFacts(opts.targetRoot);
  const conflicts = [];
  let staleNightlyConflict = false;
  let staleNightlyHash;
  for (const entry of TEMPLATE_MANIFEST) {
    if (entry.policy !== "managed") {
      continue;
    }
    const segs = entry.rel.split("/");
    const dest = join30(opts.targetRoot, ...segs);
    const src = join30(opts.templatesDir, ...segs);
    if (entry.rel === MUTATION_NIGHTLY_REL && !contract.gates.mutation.contracted) {
      if (!existsSync11(dest)) {
        continue;
      }
      const destHash = sha256Hex(await readFile19(dest, "utf8"));
      if (destHash === lock2.managed[entry.rel]) {
        staleNightlyHash = destHash;
      } else {
        staleNightlyConflict = true;
        conflicts.push(entry.rel);
      }
      continue;
    }
    if (!existsSync11(dest) || !existsSync11(src)) {
      continue;
    }
    const destText = await readFile19(dest, "utf8");
    const transform = managedTransform(entry.rel, contract, facts, opts.config.quality.gateEnv);
    const text = await readFile19(src, "utf8");
    const rendered = transform ? transform(text) : text;
    if (destText === rendered) {
      continue;
    }
    if (sha256Hex(destText) === lock2.managed[entry.rel]) {
      continue;
    }
    conflicts.push(entry.rel);
  }
  if (conflicts.length === 0) {
    return { staleNightlyHash };
  }
  if (opts.forceManaged === true && !staleNightlyConflict) {
    log36.warn(`--force-managed: re-adopting customized managed file(s): ${conflicts.join(", ")}`);
    return { staleNightlyHash };
  }
  throw new UsageError(
    `files_conflict: managed file(s) differ from both the shipped template and the recorded scaffold hash: ${conflicts.join(", ")}. Nothing was written (no seeds, gate contract, lock, or protection changes). Managed files are plugin-authored by contract \u2014 restore them (git checkout) or pass --force-managed to overwrite them with the plugin template and re-record their hashes.` + (staleNightlyConflict ? ` Note: ${MUTATION_NIGHTLY_REL} is STALE (mutation is uncontracted) and its bytes don't match the recorded scaffold hash \u2014 --force-managed cannot authorize DELETING unproven content; restore it (git checkout) or delete the file yourself.` : "")
  );
}
async function removeStaleNightly(targetRoot, expectedHash, lists, lock2) {
  const dest = join30(targetRoot, ...MUTATION_NIGHTLY_REL.split("/"));
  const current = sha256Hex(await readFile19(dest, "utf8"));
  if (current !== expectedHash) {
    throw new Error(
      `scaffold: ${MUTATION_NIGHTLY_REL} changed since preflight \u2014 not deleting; re-run factory scaffold`
    );
  }
  await unlink3(dest);
  Reflect.deleteProperty(lock2.managed, MUTATION_NIGHTLY_REL);
  lock2.dirty = true;
  lists.removed.push(MUTATION_NIGHTLY_REL);
}
async function runScaffold(opts) {
  const lists = { created: [], present: [], updated: [], removed: [] };
  const isNodePackage = existsSync11(join30(opts.targetRoot, "package.json"));
  const lockLoad = await loadScaffoldLock(opts.targetRoot);
  const lock2 = {
    seeds: { ...lockLoad.lock.seeds },
    managed: { ...lockLoad.lock.managed },
    dirty: lockLoad.invalid
  };
  const projectedSeedFiles = TEMPLATE_MANIFEST.filter(
    (e) => e.policy === "seed" && (e.nodeOnly !== true || isNodePackage) && existsSync11(join30(opts.templatesDir, ...e.rel.split("/"))) && !existsSync11(join30(opts.targetRoot, ...e.rel.split("/")))
  ).map((e) => e.rel);
  const preflightContract = await preflightGateContract({
    targetRoot: opts.targetRoot,
    securityCommand: opts.config.quality.securityCommand,
    waiveMutation: opts.waiveMutation === true,
    waiveCoverage: opts.waiveCoverage === true,
    projectedSeedFiles
  });
  const nightlyPreflight = await preflightManagedFiles(opts, lock2, preflightContract);
  let lockReported = false;
  const persistLock = async () => {
    if (!lock2.dirty) {
      return;
    }
    const toSave = { version: 1, seeds: lock2.seeds, managed: lock2.managed };
    await saveScaffoldLock(opts.targetRoot, toSave);
    lock2.dirty = false;
    if (!lockReported) {
      lockReported = true;
      if (lockLoad.existed) {
        lists.present.push(SCAFFOLD_LOCK_REL);
      } else {
        lists.created.push(SCAFFOLD_LOCK_REL);
        log36.info(`wrote ${SCAFFOLD_LOCK_REL} (pristine-tracking) \u2014 COMMIT it alongside the seeds`);
      }
    }
  };
  const reportLockPresentIfUnsaved = () => {
    if (!lockReported && lockLoad.existed) {
      lists.present.push(SCAFFOLD_LOCK_REL);
      lockReported = true;
    }
  };
  for (const entry of TEMPLATE_MANIFEST) {
    if (CI_NET_RELS.includes(entry.rel) || entry.rel === STRYKER_SEED_REL) {
      continue;
    }
    if (entry.nodeOnly === true && !isNodePackage) {
      continue;
    }
    await applyTemplate(entry, opts.templatesDir, opts.targetRoot, lists, lock2);
  }
  await persistLock();
  reportLockPresentIfUnsaved();
  const gates = await ensureGateContract({
    targetRoot: opts.targetRoot,
    securityCommand: opts.config.quality.securityCommand,
    waiveMutation: opts.waiveMutation === true,
    waiveCoverage: opts.waiveCoverage === true
  });
  if (gates.status === "created") {
    lists.created.push(GATE_CONTRACT_REL);
    log36.info(
      `wrote ${GATE_CONTRACT_REL} (stack: ${gates.stack}) \u2014 COMMIT it; 'factory run' requires the contract tracked`
    );
  } else {
    lists.present.push(GATE_CONTRACT_REL);
  }
  if (isNodePackage) {
    const present = STRYKER_CONFIG_BASENAMES.filter((b) => existsSync11(join30(opts.targetRoot, b)));
    const others = present.filter((b) => b !== STRYKER_SEED_REL);
    if (others.length > 0) {
      log36.warn(
        `not seeding ${STRYKER_SEED_REL}: found existing Stryker config(s) ${others.join(", ")} \u2014 discovery order loads '${nonNull(present[0])}'; consolidate into ONE config (shadowed siblings are silently ignored by Stryker)`
      );
    } else {
      const roots = mutationRoots(gates.contract);
      const includes = roots.map((r) => `"${r}/**/*.ts"`).join(",\n        ");
      const entry = nonNull(TEMPLATE_MANIFEST.find((e) => e.rel === STRYKER_SEED_REL));
      await applyTemplate(
        entry,
        opts.templatesDir,
        opts.targetRoot,
        lists,
        lock2,
        (text) => text.replace('"src/**/*.ts"', includes)
      );
      await persistLock();
    }
  }
  if (gates.contract.stack === "npm") {
    const facts = await readWorkflowFacts(opts.targetRoot);
    for (const entry of TEMPLATE_MANIFEST) {
      if (!CI_NET_RELS.includes(entry.rel)) {
        continue;
      }
      if (entry.rel === MUTATION_NIGHTLY_REL && !gates.contract.gates.mutation.contracted) {
        continue;
      }
      const transform = managedTransform(entry.rel, gates.contract, facts, opts.config.quality.gateEnv);
      await applyTemplate(entry, opts.templatesDir, opts.targetRoot, lists, lock2, transform);
    }
    if (!gates.contract.gates.mutation.contracted && nightlyPreflight.staleNightlyHash !== void 0) {
      await removeStaleNightly(opts.targetRoot, nightlyPreflight.staleNightlyHash, lists, lock2);
    }
    await persistLock();
    await ensurePrettierignore(opts.targetRoot, lists);
  } else {
    log36.info(
      `skipping the CI net (${CI_NET_RELS.join(", ")}) \u2014 the quality-gate workflow renders for npm-stack repos only; stack '${gates.stack}' relies on the local GateRunner`
    );
  }
  if (lists.updated.length > 0) {
    log36.info(`auto-updated ${lists.updated.length} outdated scaffold file(s): ${lists.updated.join(", ")}`);
  }
  if (lists.removed.length > 0) {
    log36.info(`removed ${lists.removed.length} stale scaffold file(s): ${lists.removed.join(", ")}`);
  }
  if (await recommendFastCheck(opts.targetRoot)) {
    log36.info(
      "property-based testing: fast-check not installed \u2014 consider 'npm i -D fast-check' so the test-writer can write property tests (advisory only)"
    );
  }
  await ensureGitignore(opts.targetRoot, lists);
  const settings = await ensureTargetSettings({
    targetRoot: opts.targetRoot,
    dataDirRules: opts.dataDirRules
  });
  const settingsRel = relative2(opts.targetRoot, settings.path);
  if (settings.created) {
    lists.created.push(settingsRel);
  } else {
    lists.present.push(settingsRel);
  }
  const branch = opts.config.git.baseBranch;
  const runScoped = opts.config.git.developProtection === "run-scoped";
  const profiles = effectiveProfiles(opts.config.git, requiredCheckExtras(gates.contract));
  const required = runScoped ? profiles.baseline : profiles.run;
  let state = await probeProtection({
    ghClient: opts.ghClient,
    owner: opts.owner,
    repo: opts.repo,
    branch
  });
  let provisioned = false;
  if (opts.provision) {
    if (runScoped) {
      if (await (opts.hasActiveRun?.() ?? Promise.resolve(false))) {
        throw new UsageError(
          `--provision refused: an active run exists for ${opts.owner}/${opts.repo} \u2014 writing the baseline now would downgrade the escalated protection on '${branch}' mid-run. Finish or cancel the run first.`
        );
      }
      await putBaselineProtection({
        ghClient: opts.ghClient,
        owner: opts.owner,
        repo: opts.repo,
        branch,
        contexts: required
      });
      state = await probeProtection({ ghClient: opts.ghClient, owner: opts.owner, repo: opts.repo, branch });
    } else {
      state = await provisionProtection({
        ghClient: opts.ghClient,
        owner: opts.owner,
        repo: opts.repo,
        branch,
        requiredChecks: required,
        provision: true
      });
    }
    provisioned = true;
  }
  requireProtectionOrRefuse(state, required, branch, { requireStrict: !runScoped });
  return {
    repo: `${opts.owner}/${opts.repo}`,
    files_created: lists.created,
    files_present: lists.present,
    files_updated: lists.updated,
    files_removed: lists.removed,
    protection: {
      enabled: state.enabled,
      strict_up_to_date: state.strictUpToDate,
      required_status_checks: state.requiredStatusChecks,
      provisioned
    },
    settings: {
      created: settings.created,
      changed: settings.changed,
      local: { created: settings.local.created, changed: settings.local.changed }
    },
    stack: gates.stack,
    gates_contract: gates.status
  };
}
async function resolveScaffoldRepo(args, overrides = {}) {
  const slug = await resolveRepo({
    explicit: optionalString(args.flag("repo")),
    cwd: overrides.cwd ?? process.cwd(),
    gitClient: overrides.gitClient ?? new DefaultGitClient()
  });
  return splitRepoSlug(slug);
}
async function run5(argv) {
  const args = parseArgs(argv, { booleans: ["provision", "force-managed"] });
  if (args.flag("help") === true) {
    return emitHelp(HELP3);
  }
  const waived = args.all("waive").map(String);
  for (const w of waived) {
    if (w !== "mutation" && w !== "coverage") {
      throw new UsageError(`--waive accepts only 'mutation' or 'coverage' (got '${w}')`);
    }
  }
  const { owner, repo } = await resolveScaffoldRepo(args);
  const dataDir = resolveDataDir();
  const report = await runScaffold({
    targetRoot: process.cwd(),
    templatesDir: resolveTemplatesDir(),
    owner,
    repo,
    config: loadConfig(),
    ghClient: new DefaultGhClient(),
    // Bake the resolved data dir into the target permission rules.
    dataDirRules: buildTargetDataDirRules({ dataDir, home: homedir2() }),
    provision: args.flag("provision") === true,
    hasActiveRun: () => new StateManager({ dataDir }).hasOtherActiveForRepo(`${owner}/${repo}`),
    waiveMutation: waived.includes("mutation"),
    waiveCoverage: waived.includes("coverage"),
    forceManaged: args.flag("force-managed") === true
  });
  emitJson(report);
  return EXIT.OK;
}
var scaffoldCommand = {
  describe: "Prepare a repo (templates + develop branch protection) for the pipeline",
  run: withUsageGuard("scaffold", run5)
};

// src/cli/subcommands/rescue.ts
var log37 = createLogger("rescue");
var RESCUE_HELP = `factory rescue \u2014 repair plumbing behind /factory:resume

Usage:
  factory rescue scan  [--run <id>]
  factory rescue apply [--run <id>] [--task <id>]... [--include-dead-ends] [--reset-e2e] [--recheck-rollup] [--reset-traceability]
  factory rescue auto  [--run <id>]
  factory rescue gc    [--apply --run <id>...]

Actions:
  scan    Classify every task (read-only); report the route + the proposed repair plan.
  apply   Reset the resettable tasks to pending; reopen a terminal run.
  auto    The runner's bounded self-heal (ONE cycle per run, after a failed finalize).
  gc      Sweep terminal runs for leftover staging branches / protection rules (D55).`;
var SCAN_HELP = `factory rescue scan \u2014 classify a stalled run (read-only)

Usage:
  factory rescue scan [--run <id>]

  --run   The run to scan (defaults to runs/current).

Emits ONE JSON document \u2014 the proposed repair plan /factory:resume renders:
the RescueScan (counts, resettable, dead_ends, needs_rescue, e2e_failed,
traceability_failed, rollup_pending, would_deadlock, summary, per-task lines)
+ the recoverable-work survey (\`work\`) + the chosen \`route\`
(nothing | resume | repair) + \`reconcile\` (git drift: recorded branch missing /
staging base gone \u2192 spawn rescue-reconciler) + \`github\` (P1 GitHub truth:
{ok:true, facts, drifts, rollup_landed} \u2014 drift classes merged-unrecorded |
closed-unmerged | stale-pr-number | pr-unrecorded | branch-missing |
staging-missing | rollup-landed; a gh outage degrades to {ok:false, error}
without failing the scan) + \`hints\` (one exact \`rescue apply\` command per
proposable repair) + \`awaiting\` (what a parked run waits on:
quota|e2e|traceability|docs|spec-approval). Writes nothing. A missing run is
a routed {kind:"nothing"} answer, not a usage error \u2014 safe to fire blind.`;
var APPLY_HELP = `factory rescue apply \u2014 reset resettable tasks and reopen a terminal run

Usage:
  factory rescue apply [--run <id>] [--task <id>]... [--answer <text>] [--include-dead-ends] [--reset-e2e] [--recheck-rollup] [--reset-traceability]

  --run                The run to recover (defaults to runs/current).
  --task               Reset exactly this task (repeatable). Overrides the default
                       resettable set; a 'done' task is a loud error, a 'pending'
                       one is skipped. An explicitly-named dead-end IS reset.
  --answer             Answer a needs-context failure's recorded question (Decision
                       69). Requires exactly ONE --task, and that task must carry a
                       recorded question (the scan line prints it). The answer is
                       injected into the next producer spawn's prompt.
  --include-dead-ends  Also reset dead-end failures (spec-defect / capability-budget).
                       Use only after the root cause is actually fixed.
  --reset-e2e          Clear a failed e2e-phase verdict (Decision 39) so it re-enters
                       and re-derives on the next pass; ALSO drops a failed run-start
                       e2e assessment (Decision 40) so it re-fires fresh. Use only
                       once the underlying cause (flaky infra, an app bug, a
                       since-fixed reopen-cap exhaustion) no longer applies. Alone
                       sufficient to reopen a terminal run even when no task itself
                       is resettable.
  --recheck-rollup     Reopen a 'completed' run whose rollup ARMED but never landed
                       (e.g. the "auto-armed" branch-policy fallback) so a re-drive
                       re-enters finalize and picks up the (by-then) merged PR. Use
                       once you've confirmed the queued merge landed. Alone
                       sufficient to reopen a terminal run.
  --reset-traceability Clear a failed PRD-traceability audit (S9, Decision 47) so it
                       re-enters and re-derives on the next drive. Use once the unmet
                       PRD intent is addressed (or the auditor crash was transient).
                       Alone sufficient to reopen a terminal run.

Default (no --task): resets stuck (crashed in-flight) + recoverable
(blocked-environmental) tasks, leaving dead-ends failed. Reopens a terminal run
to 'running' when it reset work (or when --reset-e2e clears a failed e2e phase,
--reset-traceability clears a failed audit, or --recheck-rollup targets an
armed-not-landed rollup). Idempotent.

Emits ONE JSON document:
  { run_id, run_status, reset:[...], reopened, skipped:[...] }`;
var AUTO_HELP = `factory rescue auto \u2014 the runner's bounded self-heal (up to 3 cycles per run)

Usage:
  factory rescue auto [--run <id>]

  --run   The run to self-heal (defaults to runs/current).

Fired by the runner after every failed finalize: resets the auto-safe set
(stuck + recoverable tasks whose deps are clean post-reset) \u2192 {kind:"recovered"},
or \u2014 once the 3-cycle budget is spent \u2014 pages + posts one deduped comment on the
originating PRD \u2192 {kind:"page"}. Never touches dead-ends, e2e verdicts, or rollups
(each needs a human assertion the cause is fixed). Both envelopes exit 0.`;
var GC_HELP = `factory rescue gc \u2014 sweep for orphaned staging branches / protection rules (D55)

Usage:
  factory rescue gc                       Probe GitHub for leftovers (read-only).
  factory rescue gc --apply --run <id>... Tear down the named terminal runs' leftovers.

Without --apply: probes every terminal (completed/superseded/failed) and
suspended run's pinned staging_branch and emits ONE JSON document:
  { kind:"gc", findings:[...], suspended:[...], stale:[...] }
findings are terminal runs with a live branch and/or protection rule, each with
the exact --apply command as its hint; a failed run is flagged banked:true (its
branch is deliberately kept for rescue \u2014 GC it only once the run is truly dead).
suspended runs are NEVER GC targets (deleting their branch destroys
resumability) \u2014 each gets a \`factory run cancel --run <id> --cleanup\` hint.
stale entries are run dirs this engine cannot parse (old schema / corrupt JSON,
D57) \u2014 their pointers are what crash \`run create\`; sweep them.

With --apply: deletes protection FIRST (GitHub blocks deleting a protected
ref), then the branch, for each named run. Refuses non-terminal runs. A named
STALE run dir is swept instead: best-effort branch/protection teardown (when
raw-extractable), then the dir + any \`current\` pointer naming it are deleted.
Idempotent: both deletes tolerate already-gone (404).`;
function deriveAwaiting(run9) {
  if (run9.quota !== void 0) {
    return "quota";
  }
  if (run9.e2e_assessment?.status === "failed" || run9.e2e_phase?.status === "failed") {
    return "e2e";
  }
  if (run9.traceability?.status === "failed") {
    return "traceability";
  }
  if (run9.docs?.status === "failed") {
    return "docs";
  }
  const tasks = Object.values(run9.tasks);
  const untouched = tasks.length > 0 && tasks.every((t) => t.status === "pending" && t.started_at === void 0);
  return untouched ? "spec-approval" : "unknown";
}
function chooseRoute(run9, scan) {
  if (run9.status === "completed" || run9.status === "superseded") {
    return "nothing";
  }
  if (scan.needs_rescue || scan.dead_ends.length > 0) {
    return "repair";
  }
  if (run9.status === "failed") {
    return "nothing";
  }
  return "resume";
}
function repairHints(runId, scan) {
  const hints = [];
  if (scan.resettable.length > 0) {
    hints.push(`factory rescue apply --run ${runId}`);
  }
  for (const t of scan.tasks) {
    if (t.failure_class === "needs-context" && t.status === "failed") {
      hints.push(`factory rescue apply --run ${runId} --task ${t.task_id} --answer "<answer>"`);
    }
  }
  for (const id of scan.dead_ends) {
    hints.push(`factory rescue apply --run ${runId} --task ${id} --include-dead-ends`);
  }
  if (scan.e2e_failed || scan.e2e_assessment_failed) {
    hints.push(`factory rescue apply --run ${runId} --reset-e2e`);
  }
  if (scan.traceability_failed) {
    hints.push(`factory rescue apply --run ${runId} --reset-traceability`);
  }
  if (scan.rollup_pending && scan.run_status === "completed") {
    hints.push(`factory rescue apply --run ${runId} --recheck-rollup`);
  }
  if (scan.empty_task_map) {
    hints.push(`factory run cancel --run ${runId} --cleanup`);
  }
  return hints;
}
function probeFrom(overrides) {
  const git = overrides.gitClient ?? new DefaultGitClient();
  return {
    refExists: (ref) => git.refExists(ref),
    commitsAhead: (base, branch) => git.commitsAhead(base, branch)
  };
}
async function runScan(argv, overrides = {}) {
  const args = parseArgs(argv);
  if (args.flag("help") === true) {
    return emitHelp(SCAN_HELP);
  }
  const { state } = openState();
  const explicit = args.flag("run");
  const current = typeof explicit === "string" && explicit.length > 0 ? await state.read(explicit) : await readCurrentForCwd(state, overrides);
  if (current === null) {
    emitJson({ kind: "nothing", reason: "no-run", route: "nothing" });
    return EXIT.OK;
  }
  const scan = scanRun(current);
  const route = chooseRoute(current, scan);
  const work = await assessWork(current, probeFrom(overrides));
  const reconcile = !work.base_resolved || work.tasks.some((t) => !t.branch_exists);
  const gh = overrides.ghClient ?? new DefaultGhClient();
  let github;
  try {
    github = { ok: true, ...await reconcileRun(current, gh) };
  } catch (err) {
    github = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const parked = current.status === "paused" || current.status === "suspended";
  emitJson({
    ...scan,
    work,
    route,
    reconcile,
    github,
    hints: repairHints(current.run_id, scan),
    ...parked ? { awaiting: deriveAwaiting(current) } : {}
  });
  return EXIT.OK;
}
async function runApply(argv, overrides = {}) {
  const args = parseArgs(argv, {
    booleans: ["include-dead-ends", "reset-e2e", "recheck-rollup", "reset-traceability"]
  });
  if (args.flag("help") === true) {
    return emitHelp(APPLY_HELP);
  }
  const answerFlag = args.flag("answer");
  const answer = typeof answerFlag === "string" && answerFlag.length > 0 ? answerFlag : void 0;
  const { dataDir, state } = openState();
  const runId = await resolveRunIdOrCurrent(state, args, "rescue apply", overrides);
  const tasks = args.all("task");
  const includeDeadEnds = args.flag("include-dead-ends") === true;
  const resetE2e = args.flag("reset-e2e") === true;
  const recheckRollup = args.flag("recheck-rollup") === true;
  const resetTraceability = args.flag("reset-traceability") === true;
  const git = overrides.gitClient ?? new DefaultGitClient();
  const gh = overrides.ghClient ?? new DefaultGhClient();
  const at2 = overrides.now?.() ?? nowIso();
  const adoption = await adoptForCli({ state, git, gh, dataDir }, await state.read(runId), at2);
  const adoptedDone = adoption.ok ? adoption.adopted : [];
  const result = await applyRescue(state, runId, {
    ...tasks.length > 0 ? { tasks } : {},
    includeDeadEnds,
    resetE2e,
    recheckRollup,
    resetTraceability,
    ...answer !== void 0 ? { answer } : {},
    ...adoptedDone.length > 0 ? { adoptedDone } : {}
  });
  if (result.touched) {
    await emitMetric(dataDir, runId, "human_touch", { kind: "recover" });
  }
  const after = await state.read(runId);
  const resume = result.touched && (after.status === "paused" || after.status === "suspended") ? await resumeRun(state, runId, dataDir, { touch: false }) : void 0;
  emitJson({
    ...result,
    adoption,
    ...resume?.kind === "resumed" ? { run_status: resume.run.status } : {},
    ...resume !== void 0 ? { resume } : {}
  });
  return EXIT.OK;
}
async function resumeRun(state, runId, dataDir, opts = {}) {
  const reading = await new StatuslineUsageSignal({ dataDir }).read();
  return applyResume(state, runId, reading, loadConfig({ dataDir }), nowEpoch(), opts);
}
async function emitAutoPage(gh, run9, scan, reason, adoption) {
  const marker = selfHealCommentMarker(run9.run_id);
  const target = { repo: run9.spec.repo, number: run9.spec.issue_number };
  let commented = false;
  try {
    const existing = await gh.listIssueComments(target);
    if (!existing.some((body) => body.includes(marker))) {
      const lines = [marker, `Factory self-heal for run \`${run9.run_id}\` did not proceed \u2014 ${reason}.`];
      if (scan.dead_ends.length > 0) {
        lines.push("", "Dead-end task(s) needing a human fix:");
        for (const id of scan.dead_ends) {
          lines.push(`- \`${id}\``);
        }
      }
      lines.push("", `Triage with \`factory rescue scan --run ${run9.run_id}\`.`);
      await gh.issueComment({ ...target, body: lines.join("\n") });
      commented = true;
    }
  } catch (err) {
    log37.warn(
      `run '${run9.run_id}': could not post self-heal page comment: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  emitJson({
    kind: "page",
    run_id: run9.run_id,
    run_status: run9.status,
    reason,
    dead_ends: scan.dead_ends,
    hints: repairHints(run9.run_id, scan),
    commented,
    adoption
  });
  return EXIT.OK;
}
async function runAuto(argv, overrides = {}) {
  const args = parseArgs(argv);
  if (args.flag("help") === true) {
    return emitHelp(AUTO_HELP);
  }
  requireAutonomousMode();
  const { dataDir, state } = openState();
  const runId = await resolveRunIdOrCurrent(state, args, "rescue auto", overrides);
  const at2 = overrides.now?.() ?? nowIso();
  const git = overrides.gitClient ?? new DefaultGitClient();
  const gh = overrides.ghClient ?? new DefaultGhClient();
  const before = await state.read(runId);
  const adoption = await adoptForCli({ state, git, gh, dataDir }, before, at2);
  if (!adoption.ok) {
    return emitAutoPage(
      gh,
      before,
      scanRun(before),
      "github unreachable \u2014 refusing autonomous resets without GitHub truth",
      adoption
    );
  }
  const applied = await applyRescue(state, runId, { auto: { at: at2 } });
  const after = await state.read(runId);
  const scan = scanRun(after);
  if (applied.auto_blocked === void 0) {
    await emitMetric(dataDir, runId, "self_heal", {
      attempts: applied.self_heal_attempts,
      reset: applied.reset
    });
    emitJson({
      kind: "recovered",
      run_id: runId,
      run_status: applied.run_status,
      reset: applied.reset,
      reopened: applied.reopened,
      attempts: applied.self_heal_attempts,
      adoption
    });
    return EXIT.OK;
  }
  if (adoption.changed && applied.auto_blocked === "empty") {
    emitJson({
      kind: "recovered",
      run_id: runId,
      run_status: after.status,
      reset: [],
      reopened: adoption.reopened !== false,
      adoption
    });
    return EXIT.OK;
  }
  const reason = applied.auto_blocked === "attempts" ? `self-heal budget spent (${SELF_HEAL_MAX_ATTEMPTS} cycles ran) for this run \u2014 human triage required` : "nothing auto-recoverable (dead-ends, blocked dependencies, or no resettable work) \u2014 human triage required";
  return emitAutoPage(gh, after, scan, reason, adoption);
}
async function runGc(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["apply"] });
  if (args.flag("help") === true) {
    return emitHelp(GC_HELP);
  }
  const { state } = openState();
  const gh = overrides.ghClient ?? new DefaultGhClient();
  if (args.flag("apply") === true) {
    const ids = args.all("run");
    if (ids.length === 0) {
      throw new UsageError("gc --apply requires at least one --run <id>");
    }
    const cleaned = [];
    const staleCleaned = [];
    for (const id of ids) {
      const staleDir = (await state.listStaleRunDirs()).find((d) => d.run_id === id);
      if (staleDir !== void 0) {
        staleCleaned.push(await gcApplyStale(staleDir, gh, (rid) => state.deleteRun(rid)));
        continue;
      }
      const run9 = await state.read(id);
      if (!isTerminalRunStatus(run9.status)) {
        throw new UsageError(
          `run '${id}' is ${run9.status}, not terminal \u2014 gc refuses to delete a resumable run's branch; cancel it first: factory run cancel --run ${id} --cleanup`
        );
      }
      cleaned.push(await gcApply(run9, gh));
    }
    emitJson({ kind: "gc-applied", cleaned, ...staleCleaned.length > 0 ? { stale_cleaned: staleCleaned } : {} });
    return EXIT.OK;
  }
  emitJson({ kind: "gc", ...await gcScan(await state.listRuns(), gh, await state.listStaleRunDirs()) });
  return EXIT.OK;
}
async function run6(argv) {
  const action = argv[0];
  if (action === void 0 || action === "--help" || action === "-h") {
    emitLine(RESCUE_HELP);
    return EXIT.OK;
  }
  const rest = argv.slice(1);
  switch (action) {
    case "scan":
      return runScan(rest);
    case "apply":
      return runApply(rest);
    case "auto":
      return runAuto(rest);
    case "gc":
      return runGc(rest);
    default:
      throw new UsageError(`unknown rescue action '${action}' (expected scan | apply | auto | gc)`);
  }
}
var rescueCommand = {
  describe: "Repair plumbing behind /factory:resume: scan (propose), apply (execute approved), auto (self-heal), gc (orphaned-branch sweep)",
  run: withUsageGuard("rescue", run6)
};

// src/cli/subcommands/reconcile.ts
var HELP4 = `factory reconcile \u2014 report (and optionally adopt) GitHub truth vs run state

Usage:
  factory reconcile [--run <id>] [--adopt]

  --run     The run to reconcile (defaults to runs/current).
  --adopt   Apply the forward-only repairs the report finds (Decision 60):
            record merged-unrecorded PRs as done, rebind stale pr_numbers,
            re-push missing branches, reopen a run whose rollup landed.

Probes GitHub through the gh seam and classifies state\u2194GitHub drift:
  merged-unrecorded | closed-unmerged | stale-pr-number | pr-unrecorded |
  branch-missing | staging-missing | rollup-landed

Emits ONE JSON document (the \`adoption\` field is present only under --adopt):
  { kind:"reconcile", run_id, run_status, facts, drifts, rollup_landed, adoption? }

Fails loud when gh is unavailable: GitHub facts are this command's whole job.
For a gh-outage-tolerant survey use \`factory rescue scan\` (its \`github\`
section degrades to {ok:false, error}).`;
async function runReconcile(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["adopt"] });
  if (args.flag("help") === true) {
    return emitHelp(HELP4);
  }
  const { dataDir, state } = openState();
  const runId = await resolveRunIdOrCurrent(state, args, "reconcile", overrides);
  const run9 = await state.read(runId);
  const gh = overrides.ghClient ?? new DefaultGhClient();
  const report = await reconcileRun(run9, gh);
  if (args.flag("adopt") === true) {
    const git = overrides.gitClient ?? new DefaultGitClient();
    const at2 = overrides.now?.() ?? nowIso();
    const applied = await adoptFromReport({ state, git }, run9, report, { at: at2 });
    const adoption = await mirrorAdoption(dataDir, run9.run_id, applied);
    emitJson({ kind: "reconcile", run_id: run9.run_id, run_status: run9.status, ...report, adoption });
    return EXIT.OK;
  }
  emitJson({ kind: "reconcile", run_id: run9.run_id, run_status: run9.status, ...report });
  return EXIT.OK;
}
var reconcileCommand = {
  describe: "Report GitHub truth vs recorded run state \u2014 facts + classified drift (read-only)",
  run: withUsageGuard("reconcile", runReconcile)
};

// src/cli/subcommands/score.ts
var HELP5 = `factory score \u2014 report a run's outcome summary (read-only)

Usage:
  factory score [--run <id>]
  factory score --fleet
  factory score --reviewers

  --run            The run to score (defaults to this repo's current run).
  --fleet          Report the touch metric + misses across EVERY run in the store:
                   per-run touches + metric + misses, the fleet touch aggregate
                   sum(completed) / sum(touches), and the miss roll-up
                   (total_misses, misses_per_run over terminal runs, misses_by_lens).
  --reviewers      Report per-lens review value from the review.round telemetry
                   joined with the miss ledger: rounds, confirmed blockers, yield,
                   send-back rate, and misses attributed to each lens. Also the two
                   funnel rates \u2014 citation_rate (cited/raised: did the lens quote
                   REAL code?) and confirm_rate (confirmed/cited: did its claims
                   survive an adversarial verifier?). Honest about coverage
                   (runs_covered vs runs_without_events, rounds_without_funnel).

Emits ONE JSON document:
  { kind:"score", summary }
  { kind:"fleet-score", runs, aggregate, total_misses, misses_per_run, misses_by_lens }
  { kind:"reviewer-score", lenses, runs_covered, runs_without_events, cross_vendor_absent_rounds, unattributed_misses, rounds_without_funnel }`;
async function runFleet(state) {
  const all = await state.listRuns();
  const runs = all.map((r) => ({
    run_id: r.run_id,
    status: r.status,
    touches: r.human_touches.length,
    metric: touchMetricOf(r),
    misses: r.misses.length
  }));
  const withLedger = all.filter((r) => r.human_touches.length > 0);
  const totalTouches = withLedger.reduce((n, r) => n + r.human_touches.length, 0);
  const completed = withLedger.filter((r) => r.status === "completed").length;
  const aggregate = totalTouches === 0 ? null : completed / totalTouches;
  const totalMisses = all.reduce((n, r) => n + r.misses.length, 0);
  const terminalRuns = all.filter((r) => isTerminalRunStatus(r.status)).length;
  const missesPerRun = terminalRuns === 0 ? null : totalMisses / terminalRuns;
  const missesByLens = {};
  for (const r of all) {
    for (const [lens, n] of Object.entries(missesByLensOf(r))) {
      missesByLens[lens] = (missesByLens[lens] ?? 0) + n;
    }
  }
  emitJson({
    kind: "fleet-score",
    runs,
    aggregate,
    total_misses: totalMisses,
    misses_per_run: missesPerRun,
    misses_by_lens: missesByLens
  });
  return EXIT.OK;
}
async function runReviewers(state, dataDir) {
  const all = await state.listRuns();
  const perRun = await Promise.all(
    all.map(async (r) => ({
      run_id: r.run_id,
      misses: r.misses,
      rounds: parseReviewRounds(await readMetrics(dataDir, r.run_id))
    }))
  );
  emitJson({ kind: "reviewer-score", ...aggregateReviewerValue(perRun) });
  return EXIT.OK;
}
async function runScore(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: ["fleet", "reviewers"] });
  if (args.flag("help") === true) {
    return emitHelp(HELP5);
  }
  const { dataDir, state } = openState();
  if (args.flag("fleet") === true) {
    return runFleet(state);
  }
  if (args.flag("reviewers") === true) {
    return runReviewers(state, dataDir);
  }
  const explicitRun = optionalString(args.flag("run"));
  const runState2 = explicitRun !== void 0 ? await state.read(explicitRun) : await readCurrentForCwd(state, overrides);
  if (runState2 === null) {
    throw new UsageError("score: no --run given and no current run");
  }
  const specStore = new SpecStore({ dataDir });
  const request = await specStore.read(runState2.spec.repo, runState2.spec.spec_id);
  const report = buildPartialReport(runState2, request);
  const summary = buildRunSummary(runState2, report);
  emitJson({ kind: "score", summary });
  return EXIT.OK;
}
var scoreCommand = {
  describe: "Report a run's outcome summary (read-only)",
  run: withUsageGuard("score", runScore)
};

// src/cli/subcommands/miss.ts
var HELP6 = `factory miss \u2014 record a defect the review panel missed post-merge (Decision 61)

Usage:
  factory miss [--run <id>] --task <id> --note <text> [--lens <reviewer|none>]

  --run     The run whose shipped code the defect traces to (defaults to this
            repo's current run \u2014 the per-repo pointer keeps naming the last run
            after finalize, so recording a miss days later works).
  --task    The task (\u2208 the run's tasks) whose code carries the defect.
  --note    REQUIRED human description of the defect (a miss without one is noise).
  --lens    Which reviewer lens SHOULD have caught it, or 'none'. Optional.

It is a LEDGER \u2014 repeats append (dedup is a human judgment call), and a not-yet-done
task still records (misses can surface via rollup/partial runs).

Emits ONE JSON document:
  { kind:"miss", run_id, task_id, misses:<new total> }`;
function validLenses() {
  return [...panelRolesFor(true), "none"];
}
async function runMiss(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: [] });
  if (args.flag("help") === true) {
    return emitHelp(HELP6);
  }
  const { state } = openState();
  const runId = await resolveRunIdOrCurrent(state, args, "miss", overrides);
  const run9 = await state.read(runId);
  const taskId = optionalString(args.flag("task"));
  if (taskId === void 0) {
    throw new UsageError("miss requires --task <id>");
  }
  if (run9.tasks[taskId] === void 0) {
    const ids = Object.keys(run9.tasks);
    throw new UsageError(
      `unknown --task '${taskId}' in run '${runId}'; valid task ids: ${ids.length > 0 ? ids.join(", ") : "(none)"}`
    );
  }
  const note = optionalString(args.flag("note"));
  if (note === void 0) {
    throw new UsageError("miss requires --note <text> (a miss without a description is noise)");
  }
  const lens = optionalString(args.flag("lens"));
  if (lens !== void 0 && !validLenses().includes(lens)) {
    throw new UsageError(`unknown --lens '${lens}'; valid: ${validLenses().join(", ")}`);
  }
  const taskStatus = run9.tasks[taskId].status;
  if (taskStatus !== "done") {
    emitError(
      `miss: task '${taskId}' is not 'done' (status '${taskStatus}') \u2014 recording anyway; verify the miss traces to this task's shipped code`
    );
  }
  const at2 = nowIso();
  const updated = await state.update(runId, (s) => ({
    ...s,
    misses: [...s.misses, { task_id: taskId, at: at2, note, ...lens !== void 0 ? { lens } : {} }]
  }));
  emitJson({ kind: "miss", run_id: runId, task_id: taskId, misses: updated.misses.length });
  return EXIT.OK;
}
var missCommand = {
  describe: "Record a defect the review panel missed post-merge (Decision 61)",
  run: withUsageGuard("miss", runMiss)
};

// src/cli/subcommands/next-action.ts
var HELP7 = `factory next-action \u2014 step one task until it needs agents or is terminal

Usage:
  factory next-action --run <id> --task <id> [--results <file>] [--ship-mode <mode>]

--ship-mode (optional): no-merge | live \u2014 overrides the run's persisted ship_mode for
this step only; omit to honor the persisted value (the seam default, never no-merge).

Emits ONE JSON envelope to stdout:
  { kind:"spawn", run_id, task_id, phase, request, holdout?, expects, result_key, worktree, base_ref }
  { kind:"done", run_id, task_id, outcome }
  { kind:"pause", run_id, task_id, scope, reason, resets_at_epoch? }

--results feeds back what the previous spawn envelope asked for. It MUST echo the
envelope's result_key verbatim; a stale/duplicate key rejects LOUD (re-invoke without
--results to get the current envelope):
  expects=producer-status \u2192 { "result_key": {\u2026}, "producer": { "status": "<STATUS line>" } }
  expects=reviews         \u2192 { "result_key": {\u2026}, "holdout"?: {"raw": "<validator output>"},
                              "reviews": { reviews, verifications, crossVendorAbsent? } }
Re-invoking without --results re-derives the same spawn envelope (idempotent).`;
async function run7(argv) {
  const args = parseArgs(argv, { booleans: [] });
  if (args.flag("help") === true) {
    return emitHelp(HELP7);
  }
  const runId = args.requireFlag("run");
  const taskId = args.requireFlag("task");
  const shipMode = parseShipMode(args.flag("ship-mode"));
  const results = await parseResultsFlag(args, async (path7) => parseDriveResults(await readJsonInput(path7)));
  const deps = await loadOrchestratorDeps({
    runId,
    ...shipMode !== void 0 ? { shipMode } : {}
  });
  const envelope = await nextAction(deps, runId, taskId, results);
  emitJson(envelope);
  return EXIT.OK;
}
var nextActionCommand = {
  describe: "Step one task: run deterministic steps, emit spawn/terminal/quota envelope",
  run: withUsageGuard("next-action", run7)
};

// src/cli/subcommands/next.ts
var log38 = createLogger("next-task");
var HELP8 = `factory next-task \u2014 one run-loop step: quota gate, cascade-fail, ready set

Usage:
  factory next-task [--run <id>]      (defaults to this repo's current run)

Emits ONE JSON envelope to stdout. Every variant also carries the self-resolved run
context \u2014 run_id, data_dir (canonical), ship_mode \u2014 so the runner adopts them
from the first \`next-task\`:
  { kind:"work", run_id, data_dir, ship_mode, ready:[...], cascade_failed:[...], max_parallel, stale:[...], hung:[...] }
  { kind:"finalize", run_id, data_dir, ship_mode, cascade_failed:[...] }  \u2192 call \`factory run finalize\`
  { kind:"done", run_id, data_dir, ship_mode, run_status }
  { kind:"pause", run_id, data_dir, ship_mode, scope, reason, resets_at_epoch? }

  factory next-task --assert-owner <session>          (loud-assert current-run ownership)

Ready tasks are ordered in-flight first (crash resume), then pending (spec order).
Throws LOUD on a dependency deadlock.`;
function assertCurrentOwner(current, assertOwner) {
  const expected = typeof assertOwner === "string" ? assertOwner.trim() : "";
  if (expected.length === 0) {
    return;
  }
  const actual = current.owner_session;
  if (actual === void 0) {
    return;
  }
  if (actual !== expected) {
    throw new Error(
      `next-task: this repo's current run '${current.run_id}' is owned by session '${actual}', but --assert-owner expected '${expected}' \u2014 a concurrent 'run create' moved the current pointer onto a foreign run. Pass --run <id> explicitly.`
    );
  }
}
async function runNextTask(argv, overrides = {}) {
  const args = parseArgs(argv, { booleans: [] });
  if (args.flag("help") === true) {
    return emitHelp(HELP8);
  }
  const explicit = args.flag("run");
  let runId;
  if (typeof explicit === "string" && explicit.length > 0) {
    runId = explicit;
  } else {
    const dataDir = resolveDataDir({});
    const state = new StateManager({ dataDir });
    const current = await readCurrentForCwd(state, {
      ...overrides.gitClient !== void 0 ? { gitClient: overrides.gitClient } : {}
    });
    if (current === null) {
      throw new UsageError("no --run given and no current run");
    }
    assertCurrentOwner(current, args.flag("assert-owner"));
    runId = current.run_id;
  }
  const deps = await loadOrchestratorDeps({ runId });
  const result = await nextTask(deps, runId);
  if (result.kind === "work") {
    const run9 = await deps.state.read(runId);
    const staleShipping = [...result.stale, ...result.hung].some((id) => run9.tasks[id]?.status === "shipping");
    if (staleShipping) {
      const git = overrides.gitClient ?? deps.git;
      const gh = overrides.ghClient ?? deps.gh;
      const at2 = overrides.now?.() ?? nowIso();
      const adoption = await adoptForCli({ state: deps.state, git, gh, dataDir: deps.dataDir }, run9, at2);
      if (!adoption.ok) {
        log38.warn(`adoption probe failed for run '${runId}': ${adoption.error} \u2014 emitting unchanged`);
      } else if (adoption.changed) {
        emitJson({ ...await nextTask(deps, runId), adoption });
        return EXIT.OK;
      }
    }
  }
  emitJson(result);
  return EXIT.OK;
}
var nextCommand = {
  describe: "One run-loop step: quota gate, cascade-fail, emit the ready set",
  run: withUsageGuard("next-task", runNextTask)
};

// src/cli/subcommands/statusline.ts
import { readFile as readFile20 } from "node:fs/promises";
import { join as join31 } from "node:path";

// src/shared/stdin.ts
async function readStdin(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// src/cli/subcommands/statusline.ts
var log39 = createLogger("cli:statusline");
var HELP9 = `factory statusline \u2014 capture Claude Code rate limits + chain the statusline

Wire this as the Claude Code statusLine.command. On every statusline update it
reads the piped JSON payload, writes \`rate_limits + {captured_at}\` to
\${CLAUDE_PLUGIN_DATA}/usage-cache.json (the session-mode quota pacer's input),
and \u2014 if FACTORY_ORIGINAL_STATUSLINE is set \u2014 pipes the same payload to that
command and forwards its stdout as the displayed statusline.

Usage:
  factory statusline        (reads the CC payload from stdin)

This is a side-effecting passthrough, not a machine subcommand: stdout is the
displayed statusline text, NOT a JSON envelope.`;
function cwdOf(payload) {
  if (typeof payload !== "object" || payload === null) {
    return void 0;
  }
  const p = payload;
  const fromWorkspace = p.workspace?.current_dir;
  if (typeof fromWorkspace === "string" && fromWorkspace.length > 0) {
    return fromWorkspace;
  }
  return typeof p.cwd === "string" && p.cwd.length > 0 ? p.cwd : void 0;
}
function progressEnabled(env = process.env) {
  return env.FACTORY_STATUSLINE_PROGRESS !== "0";
}
var TERMINAL_LINGER_SEC = 30 * 60;
async function renderProgress(deps, payload) {
  try {
    if (!progressEnabled(deps.env ?? process.env)) {
      return "";
    }
    const cwd = cwdOf(payload);
    if (cwd === void 0) {
      return "";
    }
    const dataDir = resolveDataDir(deps.dataDirOptions ?? {});
    const gitClient = deps.gitClient ?? new DefaultGitClient();
    const repo = await resolveRepo({ cwd, gitClient });
    const raw = await readFile20(join31(currentRepoLinkPath(dataDir, repo), STATE_FILE), "utf8");
    const run9 = JSON.parse(raw);
    if (typeof run9.run_id !== "string" || typeof run9.status !== "string") {
      return "";
    }
    if (run9.status === "completed" || run9.status === "failed" || run9.status === "superseded") {
      const endedMs = typeof run9.ended_at === "string" ? Date.parse(run9.ended_at) : NaN;
      const nowSec = (deps.now ?? nowEpoch)();
      if (!Number.isFinite(endedMs) || nowSec - endedMs / 1e3 > TERMINAL_LINGER_SEC) {
        return "";
      }
    }
    const tasks = Object.values(run9.tasks ?? {});
    const done = tasks.filter((t) => t?.status === "done").length;
    return ` ${done}/${tasks.length} tasks completed`;
  } catch {
    return "";
  }
}
function rateLimitsOf(payload) {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const rl = payload.rate_limits;
  if (typeof rl !== "object" || rl === null) {
    return null;
  }
  return rl;
}
async function writeCache(rateLimits, deps) {
  let dataDir;
  try {
    dataDir = resolveDataDir(deps.dataDirOptions ?? {});
  } catch {
    log39.warn("CLAUDE_PLUGIN_DATA unresolvable; skipping usage-cache.json write");
    return "usage-cache skipped: CLAUDE_PLUGIN_DATA unresolvable";
  }
  const now = (deps.now ?? nowEpoch)();
  const cache = { ...rateLimits, captured_at: now };
  try {
    await atomicWriteFile(usageCachePath(dataDir), stringifyJson(cache));
    return null;
  } catch (err) {
    log39.warn(`failed to write usage-cache.json: ${err.message}`);
    return `usage-cache unwritable: ${err.message}`;
  }
}
async function passthrough(payload, deps) {
  const original = deps.originalStatusline ?? process.env.FACTORY_ORIGINAL_STATUSLINE ?? "";
  if (original.trim().length === 0) {
    return "";
  }
  try {
    const run9 = deps.exec ?? exec;
    const result = await run9(original, [], { shell: true, input: payload, timeoutMs: 3e3 });
    if (result.code !== 0) {
      const why = result.code === null ? `was killed by signal ${result.signal ?? "unknown"} (likely the 3s timeout)` : `exited ${result.code}`;
      log39.warn(`FACTORY_ORIGINAL_STATUSLINE ${why}; statusline left empty`);
      return "";
    }
    return result.stdout;
  } catch (err) {
    log39.warn(`FACTORY_ORIGINAL_STATUSLINE failed to run: ${err.message}`);
    return "";
  }
}
async function runStatusline(argv = [], deps = {}) {
  const args = parseArgs(argv);
  if (args.flag("help") === true) {
    return emitHelp(HELP9);
  }
  const payload = deps.readStdin ? await deps.readStdin() : await readStdin(deps.stdin);
  let parsed;
  try {
    parsed = payload.trim().length > 0 ? JSON.parse(payload) : void 0;
  } catch {
    parsed = void 0;
  }
  const rateLimits = rateLimitsOf(parsed);
  const cacheFailure = rateLimits !== null ? await writeCache(rateLimits, deps) : null;
  const displayed = await passthrough(payload, deps);
  const progress = await renderProgress(deps, parsed);
  const write = deps.writeStdout ?? ((text) => process.stdout.write(text));
  const base = cacheFailure === null ? displayed : `${displayed} [factory: ${cacheFailure}]`;
  write(`${base}${progress}`.trimStart());
  return EXIT.OK;
}
var statuslineCommand = {
  describe: "Capture Claude Code rate limits to usage-cache.json + chain the statusline",
  run: (argv) => runStatusline(argv)
};

// src/cli/subcommands/autonomy.ts
import { existsSync as existsSync12 } from "node:fs";
import { readFile as readFile21 } from "node:fs/promises";
import { createHash as createHash3 } from "node:crypto";
import { join as join32 } from "node:path";
import { homedir as homedir3 } from "node:os";
var log40 = createLogger("autonomy");
var HELP10 = `factory autonomy <ensure|status|preflight> \u2014 manage / inspect autonomous mode

The pipeline runs unattended: \`run create\`/\`run resume\` HALT unless the session
is autonomous (FACTORY_AUTONOMOUS_MODE=1). There is no opt-out.

ensure     Merges templates/settings.autonomous.json with your existing settings into
           \${CLAUDE_PLUGIN_DATA}/merged-settings.json (placeholders substituted, env
           baked, statusLine wired to \`factory statusline\`) and prints the relaunch
           command:

             claude --worktree --settings <merged-settings.json>

status     Reports whether THIS session is autonomous and whether merged-settings.json
           exists. Exits 0 when autonomous, 1 when not (never throws).

preflight  The run-entry check (what \`/factory:run\` calls). Decides over
           {autonomous?, merged-settings present?, expected vs stored settings
           content hash (FACTORY_SETTINGS_HASH)} whether the run may proceed.
           (Re)scaffolds merged-settings.json and halts for a relaunch when the
           session is not autonomous OR the settings are stale / missing /
           unstamped; proceeds silently when already fresh (or autonomous via a
           directly-exported env). Exits 0 to proceed, 1 to halt. Never throws on
           the decision path.

Usage:
  factory autonomy ensure
  factory autonomy status [--json]
  factory autonomy preflight

Options:
  --user-settings <path>   (ensure / preflight) Override the user-settings source (default: ~/.claude/settings.json)
  --json                   (status) Emit machine-readable JSON`;
function factoryBinPath(pluginRoot) {
  return `${pluginRoot}/bin/factory`;
}
function mergedSettingsPath(dataDir) {
  return join32(dataDir, "merged-settings.json");
}
function tildeExpand(value, home) {
  if (value.startsWith("~")) {
    return home + value.slice(1);
  }
  return value;
}
function substitutePlaceholders(value, vars) {
  if (typeof value === "string") {
    return value.split("${CLAUDE_PLUGIN_ROOT}").join(vars.pluginRoot).split("${CLAUDE_PLUGIN_DATA_TILDE}").join(vars.dataDirTilde).split("${CLAUDE_PLUGIN_DATA}").join(vars.dataDir);
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitutePlaceholders(v, vars));
  }
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substitutePlaceholders(v, vars);
    }
    return out;
  }
  return value;
}
function isObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function canonicalSettingsHash(merged, pluginRoot) {
  const walk = (value) => {
    if (typeof value === "string") {
      return value.split(pluginRoot).join("${CLAUDE_PLUGIN_ROOT}");
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (isObject2(value)) {
      const out = {};
      for (const k of Object.keys(value).sort()) {
        out[k] = walk(value[k]);
      }
      return out;
    }
    return value;
  };
  const env = isObject2(merged.env) ? { ...merged.env } : void 0;
  if (env !== void 0) {
    delete env.FACTORY_SETTINGS_HASH;
  }
  const input = env !== void 0 ? { ...merged, env } : merged;
  return createHash3("sha256").update(JSON.stringify(walk(input))).digest("hex");
}
function statusLineCommandOf(settings) {
  const sl = settings.statusLine;
  if (!isObject2(sl)) {
    return void 0;
  }
  const cmd = sl.command;
  return typeof cmd === "string" && cmd.length > 0 ? cmd : void 0;
}
function materializeMergedSettings(input) {
  const { dataDir, pluginRoot, home } = input;
  const parsedTemplate = JSON.parse(input.template);
  if (!isObject2(parsedTemplate)) {
    throw new Error("autonomy: settings.autonomous.json is not a JSON object");
  }
  const template = substitutePlaceholders(parsedTemplate, {
    pluginRoot,
    dataDir,
    dataDirTilde: tildeShorten(dataDir, home)
  });
  const merged = { ...input.userSettings, ...template };
  const userEnv = isObject2(input.userSettings.env) ? input.userSettings.env : {};
  const templateEnv = isObject2(template.env) ? template.env : {};
  const env = { ...userEnv, ...templateEnv };
  env.CLAUDE_PLUGIN_DATA = dataDir;
  const userPerms = isObject2(input.userSettings.permissions) ? input.userSettings.permissions : {};
  const templatePerms = isObject2(template.permissions) ? template.permissions : {};
  const userAllow = Array.isArray(userPerms.allow) ? userPerms.allow.filter((e) => typeof e === "string") : [];
  const templateAllow = Array.isArray(templatePerms.allow) ? templatePerms.allow.filter((e) => typeof e === "string") : [];
  const unionedAllow = [...userAllow, ...templateAllow.filter((e) => !userAllow.includes(e))];
  merged.permissions = { ...userPerms, ...templatePerms, allow: unionedAllow };
  const ourPath = factoryBinPath(pluginRoot);
  const userStatusLine = statusLineCommandOf(input.userSettings);
  const chained = (() => {
    if (userStatusLine === void 0) {
      return void 0;
    }
    const expanded = tildeExpand(userStatusLine, home);
    const parts = expanded.split(/\s+/);
    const expandedPath = parts[0] ?? expanded;
    const expandedSub = parts[1];
    const isOurs = expandedPath === ourPath && expandedSub === "statusline";
    return isOurs ? void 0 : expanded;
  })();
  if (chained !== void 0) {
    env.FACTORY_ORIGINAL_STATUSLINE = chained;
  } else {
    delete env.FACTORY_ORIGINAL_STATUSLINE;
  }
  merged.env = env;
  env.FACTORY_SETTINGS_HASH = canonicalSettingsHash(merged, pluginRoot);
  return merged;
}
async function readUserSettings(path7) {
  if (!existsSync12(path7)) {
    return {};
  }
  try {
    const parsed = JSON.parse(await readFile21(path7, "utf8"));
    if (isObject2(parsed)) {
      return parsed;
    }
    log40.warn(`${path7} is not a JSON object; ignoring`);
  } catch (err) {
    log40.warn(`could not parse ${path7} (${err.message}); ignoring`);
  }
  return {};
}
async function runAutonomyEnsure(opts = {}) {
  const home = opts.home ?? homedir3();
  const dataDir = opts.dataDir ?? resolveDataDir();
  const pluginRoot = opts.pluginRoot ?? resolvePluginRoot();
  const userSettingsPath = opts.userSettingsPath ?? join32(home, ".claude", "settings.json");
  const write = opts.writeStdout ?? ((t) => process.stdout.write(t));
  const userSettings = await readUserSettings(userSettingsPath);
  const templatePath = join32(pluginRoot, "templates", "settings.autonomous.json");
  const template = await readFile21(templatePath, "utf8");
  const merged = materializeMergedSettings({
    template,
    userSettings,
    dataDir,
    pluginRoot,
    home
  });
  const path7 = mergedSettingsPath(dataDir);
  await atomicWriteFile(path7, stringifyJson(merged));
  const relaunchCommand = `claude --worktree --settings ${path7}`;
  write(
    `Wrote autonomous settings \u2192 ${path7}
Relaunch the session in autonomous mode with:

  ${relaunchCommand}

(the first agent turn refreshes the usage cache \u2192 session-mode quota pacing.)
`
  );
  return { path: path7, relaunchCommand };
}
function runAutonomyStatus(opts = {}) {
  const env = opts.env ?? process.env;
  const write = opts.writeStdout ?? ((t) => process.stdout.write(t));
  let path7 = "";
  try {
    const dataDir = opts.dataDir ?? resolveDataDir();
    path7 = mergedSettingsPath(dataDir);
  } catch {
  }
  const status = {
    autonomous: isAutonomous(env),
    envSet: env.FACTORY_AUTONOMOUS_MODE !== void 0,
    mergedSettingsPresent: path7.length > 0 && existsSync12(path7),
    mergedSettingsPath: path7
  };
  if (opts.json === true) {
    write(stringifyJson(status) + "\n");
  } else if (status.autonomous) {
    write(
      `autonomous: yes (FACTORY_AUTONOMOUS_MODE=1)
merged-settings: ${status.mergedSettingsPresent ? "present" : "absent"}${path7.length > 0 ? ` at ${path7}` : ""}
`
    );
  } else {
    write(
      `autonomous: NO \u2014 the pipeline will refuse to start or resume a run.
merged-settings: ${status.mergedSettingsPresent ? `present at ${path7}` : "absent"}
` + (status.mergedSettingsPresent ? `Relaunch the session with:
  claude --worktree --settings ${path7}
` : `Run \`factory autonomy ensure\` first, then relaunch with the printed command.
`)
    );
  }
  return Promise.resolve(status.autonomous ? EXIT.OK : EXIT.ERROR);
}
async function readStoredHash(path7) {
  if (!existsSync12(path7)) {
    return void 0;
  }
  try {
    const parsed = JSON.parse(await readFile21(path7, "utf8"));
    if (isObject2(parsed) && isObject2(parsed.env) && typeof parsed.env.FACTORY_SETTINGS_HASH === "string") {
      return parsed.env.FACTORY_SETTINGS_HASH;
    }
  } catch {
  }
  return void 0;
}
var shortHash = (h) => h === void 0 ? "?" : h.slice(0, 12);
function describePreflightReason(reason, expectedHash, storedHash) {
  switch (reason) {
    case "fresh":
      return `merged settings are current (settings hash ${shortHash(expectedHash)})`;
    case "ci-raw-env":
      return "autonomous via the environment directly; no merged-settings file needed";
    case "hash-unknowable":
      return "the expected settings hash is uncomputable \u2014 leaving the existing merged settings untouched";
    case "missing-settings":
      return "no merged settings exist yet";
    case "not-autonomous":
      return "this session is not autonomous";
    case "stale-settings":
      return `merged settings content is stale (${shortHash(storedHash)} \u2192 ${shortHash(expectedHash)})`;
    case "unstamped":
      return "merged settings predate content-hash stamping (treated as stale)";
  }
}
async function runAutonomyPreflight(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir3();
  const write = opts.writeStdout ?? ((t) => process.stdout.write(t));
  let dataDir;
  let pluginRoot;
  try {
    dataDir = opts.dataDir ?? resolveDataDir();
  } catch {
  }
  try {
    pluginRoot = opts.pluginRoot ?? resolvePluginRoot();
  } catch {
  }
  const path7 = dataDir !== void 0 ? mergedSettingsPath(dataDir) : "";
  const mergedSettingsPresent = path7.length > 0 && existsSync12(path7);
  let expectedHash;
  if (dataDir !== void 0 && pluginRoot !== void 0) {
    try {
      const template = await readFile21(join32(pluginRoot, "templates", "settings.autonomous.json"), "utf8");
      const userSettings = await readUserSettings(opts.userSettingsPath ?? join32(home, ".claude", "settings.json"));
      const merged = materializeMergedSettings({ template, userSettings, dataDir, pluginRoot, home });
      const stamped = merged.env.FACTORY_SETTINGS_HASH;
      expectedHash = typeof stamped === "string" ? stamped : void 0;
    } catch {
    }
  }
  const storedHash = mergedSettingsPresent ? await readStoredHash(path7) : void 0;
  const decision = decideAutonomyPreflight({
    autonomous: isAutonomous(env),
    mergedSettingsPresent,
    expectedHash,
    storedHash
  });
  const verdict = describePreflightReason(decision.reason, expectedHash, storedHash);
  if (decision.regenerate) {
    if (dataDir === void 0 || pluginRoot === void 0) {
      write(
        `HALT: ${verdict}.
Cannot resolve the plugin data/root dir to scaffold autonomous settings here \u2014 run \`factory autonomy ensure\` once the environment is set, then relaunch with the printed command.
`
      );
      return EXIT.ERROR;
    }
    await runAutonomyEnsure({
      dataDir,
      pluginRoot,
      userSettingsPath: opts.userSettingsPath,
      home,
      writeStdout: write
    });
    write(`
HALT: ${verdict} \u2014 relaunch to continue (command above).
`);
    return EXIT.ERROR;
  }
  write(`OK: autonomous mode ready \u2014 ${verdict}.
`);
  return EXIT.OK;
}
async function run8(argv) {
  const args = parseArgs(argv, { booleans: ["json"] });
  if (args.flag("help") === true) {
    return emitHelp(HELP10);
  }
  const verb = args.positionals[0];
  if (verb === "status") {
    return runAutonomyStatus({ json: args.flag("json") === true });
  }
  const userSettings = args.flag("user-settings");
  if (verb === "preflight") {
    return runAutonomyPreflight({
      userSettingsPath: typeof userSettings === "string" ? userSettings : void 0
    });
  }
  if (verb !== void 0 && verb !== "ensure") {
    emitError(`autonomy: unknown verb '${verb}' (expected: ensure | status | preflight)`);
    return EXIT.USAGE;
  }
  await runAutonomyEnsure({
    userSettingsPath: typeof userSettings === "string" ? userSettings : void 0
  });
  return EXIT.OK;
}
var autonomyCommand = {
  describe: "Materialize merged-settings.json for an autonomous relaunch + print the command",
  run: withUsageGuard("autonomy", run8)
};

// src/cli/main.ts
var cliRegistry = {
  "config-defaults": {
    describe: "Print the resolved config (defaults + any config.json) as JSON",
    run: () => {
      const cfg = loadConfig();
      process.stdout.write(stringifyJson(cfg));
      return EXIT.OK;
    }
  },
  configure: configureCommand,
  debug: debugCommand,
  resume: resumeCommand,
  run: runCommand,
  spec: specCommand,
  rescue: rescueCommand,
  reconcile: reconcileCommand,
  score: scoreCommand,
  miss: missCommand,
  state: stateCommand,
  scaffold: scaffoldCommand,
  "next-action": nextActionCommand,
  "next-task": nextCommand,
  statusline: statuslineCommand,
  autonomy: autonomyCommand
};
function printHelp() {
  const names = Object.keys(cliRegistry).sort();
  const width = names.reduce((m, n) => Math.max(m, n.length), 0);
  const lines = [
    "factory \u2014 autonomous coding pipeline CLI",
    "",
    "Usage: factory <subcommand> [options]",
    "",
    "Subcommands:",
    ...names.map((n) => `  ${n.padEnd(width)}  ${nonNull(cliRegistry[n]).describe}`),
    "",
    "Run `factory <subcommand> --help` for subcommand-specific help."
  ];
  process.stdout.write(lines.join("\n") + "\n");
}
async function dispatch2(argv) {
  const [name, ...rest] = argv;
  if (name === void 0 || name === "--help" || name === "-h") {
    printHelp();
    return EXIT.OK;
  }
  const cmd = cliRegistry[name];
  if (!cmd) {
    process.stderr.write(`factory: unknown subcommand '${name}'. Run \`factory --help\` for usage.
`);
    return EXIT.USAGE;
  }
  return cmd.run(rest);
}

// src/bin/factory.ts
dispatch2(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(detail + "\n");
  process.exit(EXIT.ERROR);
});
