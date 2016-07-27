'use strict';

// Include Gulp & tools we'll use
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var del = require('del');
var runSequence = require('run-sequence');
var browserSync = require('browser-sync');
var express = require('express');
var reload = browserSync.reload;
var merge = require('merge-stream');
var path = require('path');
var fs = require('fs');
var glob = require('glob-all');
var historyApiFallback = require('connect-history-api-fallback');
var drakov = require('drakov');
var packageJson = require('./package.json');
var crypto = require('crypto');
var ensureFiles = require('./tasks/ensure-files.js');
var request = require('request');

var AUTOPREFIXER_BROWSERS = [
  'ie >= 10',
  'ie_mob >= 10',
  'ff >= 30',
  'chrome >= 34',
  'safari >= 7',
  'opera >= 23',
  'ios >= 7',
  'android >= 4.4',
  'bb >= 10'
];

var DIST = 'dist';

var dist = function(subpath) {
  return !subpath ? DIST : path.join(DIST, subpath);
};

var politifactProxy = function(req, res, next) {
  let matches = req.url.match(/^\/politifact(.*)/);
  let api = matches && matches[1];
  if (api) {
    request(`http://politifact.com/${api}`, (error, response, body) => {
      res.end(body);
    });
    return;
  }
  next();
};
var styleTask = function(stylesPath, srcs) {
  return gulp.src(srcs.map(function(src) {
      return path.join('app', stylesPath, src);
    }))
    .pipe($.changed(stylesPath, {extension: '.css'}))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    .pipe(gulp.dest('.tmp/' + stylesPath))
    .pipe($.minifyCss())
    .pipe(gulp.dest(dist(stylesPath)))
    .pipe($.size({title: stylesPath}));
};

var imageOptimizeTask = function(src, dest) {
  return gulp.src(src)
    .pipe($.imagemin({
      progressive: true,
      interlaced: true
    }))
    .pipe(gulp.dest(dest))
    .pipe($.size({title: 'images'}));
};

var optimizeHtmlTask = function(src, dest) {
  var assets = $.useref.assets({
    searchPath: ['.tmp', 'app']
  });

  return gulp.src(src)
    .pipe(assets)
    // Concatenate and minify JavaScript
    .pipe($.if('*.js', $.uglify({
      preserveComments: 'some'
    })))
    // Concatenate and minify styles
    // In case you are still using useref build blocks
    .pipe($.if('*.css', $.minifyCss()))
    .pipe(assets.restore())
    .pipe($.useref())
    // Minify any HTML
    .pipe($.if('*.html', $.minifyHtml({
      quotes: true,
      empty: true,
      spare: true
    })))
    // Output files
    .pipe(gulp.dest(dest))
    .pipe($.size({
      title: 'html'
    }));
};

// Compile and automatically prefix stylesheets
gulp.task('styles', function() {
  return styleTask('styles', ['**/*.css']);
});

gulp.task('elements', function() {
  return styleTask('elements', ['**/*.css']);
});

// Ensure that we are not missing required files for the project
// "dot" files are specifically tricky due to them being hidden on
// some systems.
gulp.task('ensureFiles', function(cb) {
  var requiredFiles = ['.bowerrc'];

  ensureFiles(requiredFiles.map(function(p) {
    return path.join(__dirname, p);
  }), cb);
});

gulp.task('pug', function() {
  return gulp.src('app/**/*.pug')
    .pipe($.pug({pretty: true}))
    .pipe(gulp.dest('.tmp'));
});

// Transpile all JS to ES5.
gulp.task('js', function () {
  return gulp.src(['.tmp/**/*.{js,html}', '!.tmp/bower_components/**/*'])
   .pipe($.sourcemaps.init())
   .pipe($.if('*.html', $.crisper({scriptInHead:false}))) // Extract JS from .html files
   .pipe($.if('*.js', $.babel({
     presets: ['es2015']
   })))
   .pipe($.sourcemaps.write('.'))
   .pipe(gulp.dest('.tmp/'))
   .pipe(gulp.dest(dist()));
});

// Optimize images
gulp.task('images', function() {
  return imageOptimizeTask('app/images/**/*', dist('images'));
});

// Copy all files at the root level (app)
gulp.task('copy', function() {
  var appUtilsJsToTmp = gulp.src([
    'app/test/**/*.js'
  ], {
    dot: true
  }).pipe(gulp.dest('.tmp/test'));

  var appJsToTmp = gulp.src([
    'app/scripts/*.js'
  ], {
    dot: true
  }).pipe(gulp.dest('.tmp/scripts'));

  var bowerAppToTmp = gulp.src([
    'app/bower_components/**/*'
  ], {
    dot: true
  }).pipe(gulp.dest('.tmp/bower_components'));

  var tmp = gulp.src([
    '.tmp/**/*.*',
    '!.tmp/bower_components/**/*',
  ], {
    dot: true
  }).pipe(gulp.dest(dist()));

  // Copy over only the bower_components we need
  // These are things which cannot be vulcanized
  var bower = gulp.src([
    'app/bower_components/{webcomponentsjs,platinum-sw,sw-toolbox,promise-polyfill}/**/*'
  ]).pipe(gulp.dest(dist('bower_components')));

  return merge(bowerAppToTmp, tmp, bower)
    .pipe($.size({
      title: 'copy'
    }));
});

// Copy web fonts to dist
gulp.task('fonts', function() {
  return gulp.src(['app/fonts/**'])
    .pipe(gulp.dest(dist('fonts')))
    .pipe($.size({
      title: 'fonts'
    }));
});

// Scan your HTML for assets & optimize them
gulp.task('html', function() {
  return optimizeHtmlTask(
    ['.tmp/**/*.html', '!.tmp/{elements,test,bower_components}/**/*.html'],
    dist());
});

// Vulcanize granular configuration
gulp.task('vulcanize', function() {
  return gulp.src('.tmp/elements/elements.html')
   .pipe($.vulcanize({
     stripComments: true,
     inlineCss: true,
     inlineScripts: true,
     redirects: '../bower_components|app/bower_components'
   }))
   .pipe(gulp.dest(dist('elements')))
   .pipe($.size({title: 'vulcanize'}));
});

// Generate config data for the <sw-precache-cache> element.
// This include a list of files that should be precached, as well as a (hopefully unique) cache
// id that ensure that multiple PSK projects don't share the same Cache Storage.
// This task does not run by default, but if you are interested in using service worker caching
// in your project, please enable it within the 'default' task.
// See https://github.com/PolymerElements/polymer-starter-kit#enable-service-worker-support
// for more context.
gulp.task('cache-config', function(callback) {
  var dir = dist();
  var config = {
    cacheId: packageJson.name || path.basename(__dirname),
    disabled: false
  };

  glob([
    'index.html',
    './',
    'bower_components/webcomponentsjs/webcomponents-lite.min.js',
    '{elements,scripts,styles}/**/*.*'],
    {cwd: dir}, function(error, files) {
    if (error) {
      callback(error);
    } else {
      config.precache = files;

      var md5 = crypto.createHash('md5');
      md5.update(JSON.stringify(config.precache));
      config.precacheFingerprint = md5.digest('hex');

      var configPath = path.join(dir, 'cache-config.json');
      fs.writeFile(configPath, JSON.stringify(config), callback);
    }
  });
});

// Clean output directory
gulp.task('clean', function(done) {
  return del(['.tmp', dist()]);
});

gulp.task('drakov', function() {
  var argv = {
    sourceFiles: './api/apiary.apib',
    serverPort: 5000,
    autoOptions: true,
    method: ['PATCH', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }
  var app = express();
  drakov.middleware.init(app, argv, (err, middleWareFunction) => {
    app.use('/api/v3', middleWareFunction);
    app.listen(argv.serverPort);
  });
});


// Watch files for changes & reload
gulp.task('serve', ['styles', 'elements', 'pug_and_js'], function() {
  browserSync.init({
    port: 5001,
    notify: false,
    logPrefix: 'PSK',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function(snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: {
      baseDir: ['.tmp', 'app', 'test_data'],
      middleware: [historyApiFallback(), politifactProxy]
    }
  });

  gulp.watch(['app/**/*.pug'], ['pug_and_js', reload]);
  gulp.watch(['app/styles/**/*.css'], ['styles', reload]);
  gulp.watch(['app/elements/**/*.css'], ['elements', reload]);
  //gulp.watch(['app/{scripts,elements}/**/{*.js,*.html}'], ['js']);
  gulp.watch(['app/images/**/*'], reload);
});

// Build and serve the output from the dist build
gulp.task('serve:dist', ['default'], function() {
  browserSync({
    port: 5001,
    notify: false,
    logPrefix: 'PSK',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function(snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: dist(),
    middleware: [historyApiFallback()]
  });
});

// Build production files, the default task
gulp.task('default', ['clean'], function(cb) {
  // Uncomment 'cache-config' if you are going to use service workers.
  runSequence(
    ['ensureFiles', 'pug', 'copy', 'styles'],
    'elements',
    ['images', 'fonts', 'html'],
    'vulcanize', // 'cache-config',
    cb);
});

gulp.task('pug_and_js', [], function(cb) {
  runSequence('pug', 'js', cb);
});

// Load tasks for web-component-tester
// Adds tasks for `gulp test:local` and `gulp test:remote`
require('web-component-tester').gulp.init(gulp);

gulp.task('test_pug', [], function(cb) {
  runSequence('default', 'test:local');
});
// Load custom tasks from the `tasks` directory
try {
  require('require-dir')('tasks');
} catch (err) {}
