var _ = require('lodash');
var methods = require('methods');
var pathtoregexp = require('path-to-regexp');
var url = require('url');
var slice = Array.prototype.slice;
var flatten = require('array-flatten');

module.exports = construct(); // singleton

module.exports.construct = construct;

function construct() {
  var _options;

  var reverse = function(express, options) {
    reverse.integrate(express.Router, options);
    reverse.integrate(express.application, options);
    _options = options;
    return reverse;
  };

  reverse._namedroutes = {};

  reverse.getroutes = function getroutes() {
    return _.map(this._namedroutes, function(value) {
      return { name: value.name, path: value.path() };
    });
  };

  reverse.register = function register(name, path, builder) {
    // validate parameters
    if (name === undefined)
      throw new Error('Required parameter "name" missing');
    if (path === undefined)
      throw new Error('Required parameter "path" missing');
    // validate conditions
    if (this._namedroutes[name] !== undefined)
      throw new Error('Route with name "' + name + '" already defined');
    // clean parameters
    if (typeof path !== 'function') {
      path = function path() { return path; };
    }
    if (builder === undefined) {
      builder = function builder(params) { return params; };
    }
    // add route to the dictionary
    this._namedroutes[name] = { name: name, path: path, builder: builder };
  };

  reverse.resolve = function resolve(name, params, req) {
    // validate parameters
    if (name === undefined)
      throw new Error('Required parameter "name" missing');
    // validate conditions
    if (this._namedroutes[name] === undefined)
      throw new Error('Route with name "' + name + '" not defined');
    // look up route in dictionary
    var route = this._namedroutes[name];
    // clean parameters
    params = route.builder(params);
    // evaluate path and build url
    var link = this.build(route.path(), params);
    // Get baseurl
    var baseurl = _options.baseurl;
    if(baseurl instanceof Function) {
      baseurl = baseurl(req);
    }
    // return url
    return url.resolve(baseurl, link);
  };

  reverse.build = function build(path, params) {
    return pathtoregexp.compile(path)(params);
  };

  reverse.defaults = { baseurl: '/', strict: true };

  // make reverse register available on routers
  reverse.integrate = function integrate(router, options) {

    options = _.extend({}, reverse.defaults, options);

    var use = router.use;
    router.use = function(fn) {
      var offset = 0;
      var path = '/';

      // default path to '/'
      // disambiguate router.use([fn])
      if (typeof fn !== 'function') {
        var arg = fn;

        while (Array.isArray(arg) && arg.length !== 0) {
          arg = arg[0];
        }

        // first arg is the path
        if (typeof arg !== 'function') {
          offset = 1;
          path = fn;
        }
      }

      var callbacks = flatten(slice.call(arguments, offset));
      var self = this;
      callbacks.forEach(function(callback) {
        callback.contextpath = function() {
          if(! self.contextpath)
            return path;
          return self.contextpath() + path;
        }
      });

      return use.apply(this, arguments);
    };

    router.define = function define(name, builder) {
      // construct the route handler
      var route = construct_routehandler(this, name, options);
      // reverse register the route
      if (route.name !== undefined)
        reverse.register(route.name, route.fullpath, builder);
      // construct the route handler
      return route;
    };
  };

  // make reverse resolve available to views and controllers
  reverse.init = function init() {
    return function(req, res, next) {
      var resolve = reverse.resolve.bind(reverse);
      res.locals.resolve = function(name, params){
        return resolve(name, params, req);
      };
      res.resolveredirect = function resolveredirect(name, params) {
        return res.redirect(resolve(name, params, req));
      };
      next();
    };
  };

  return reverse;
}

function construct_routehandler(router, name, options) {

  var route = {};
  // create router hook on route
  route.router = router;
  // set name of the route
  route.name = name;
  // set path of the route as undefined
  route.path = undefined;

  // contextpath resolver
  route.contextpath = function contextpath() {
    // validate conditions
    if (this.path === undefined)
      throw new Error('No path registered with route "' + this.name + '"');
    // evaluate and return the contextpath
    if (this.router.contextpath)
      return [].concat(this.router.contextpath(), this.path);
    else
      return [].concat(this.path);
  };

  // bind contextpath resolver to route
  route.contextpath = route.contextpath.bind(route);

  // fullpath resolver
  route.fullpath = function fullpath() {
    var parts = this.contextpath();
    parts = parts.filter(function(part) {
      return part;
    });
    parts = parts.map(function(part) {
      var start = 0, end = part.length;
      if (part.startsWith('/'))
        start = start + 1;
      if (part.endsWith('/'))
        end = end - 1;
      return part.substr(start, end);
    });
    parts = parts.filter(function(part) {
      return part;
    });

    return parts.join('/');
  };

  // bind fullpath resolver to route
  route.fullpath = route.fullpath.bind(route);

  // wrap and expose router.method
  route._wrap = function wrap(method) {
    route[method] = function handler() {
      var path, offset;
      // clean parameters
      if (typeof arguments[0] === 'string') {
        path = arguments[0]; offset = 1;
      } else {
        path = '/'; offset = 0;
      }
      // validate parameters
      if (path === undefined)
        throw new Error('Required parameter "path" missing');
      if (typeof path !== 'string')
        throw new Error('Required parameter "path" must be of type string');
      // validate conditions
      if (this.path !== undefined)
        throw new Error('Already a path registered with route "' + this.name + '"');
      // set the path of the route
      this.path = path;
      // create a contextpath resolver hook on the middleware
      for (var i = offset; i < arguments.length; i = i + 1) {
        arguments[i].contextpath = this.contextpath;
      }
      // call the method
      return this.router[method].apply(this.router, arguments);
    };
  };

  // create handlers on route for all methods
  for (var i = 1; i < methods.length; i = i + 1) {
    route._wrap(methods[i]);
  }
  route._wrap('all');
  route._wrap('use');
  route._wrap('route');

  return route;
}
