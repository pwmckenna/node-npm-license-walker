#!/usr/bin/env node

process.title = 'npm-license-walker';

var write = process.stdout.write.bind(process.stdout);
process.stdout.write = function () {};
process.stderr.write = function () {};

var q = require('q');
var assert = require('assert');
var npm = require('npm');
require('colors');
var _ = require('lodash');

assert(process.argv.length > 2);

var walkNpmPackageLicenses = function (pkg) {
    var packageInfoRequest = q.defer();
    npm.info(pkg, packageInfoRequest.makeNodeResolver());
    return packageInfoRequest.promise.spread(function (res) {
        var versions = Object.keys(res);
        return q.all(_.map(versions, function (version) {
            var release = res[version];
            var name = release.name;

            var depPkgs = Object.keys(res[version].dependencies || {});
            return q.all(_.map(depPkgs, walkNpmPackageLicenses)).then(function (dependencies) {
                var ret = {
                    name: name,
                    dependencies: _.flatten(dependencies)
                };
                if (release.hasOwnProperty('license')) {
                    ret.license = release.license;
                }
                if (release.hasOwnProperty('licenses')) {
                    ret.license = release.licenses;
                }
                return q.resolve(ret);
            });
        }));
    });
};

var stringifyDependencies = function (data, indent) {
    return _.reduce(data, function (memo, pkg) {
        var indentation = '';
        _.times(indent, function () {
            indentation += ' ';
        });
        var ret = memo + indentation + pkg.name + ' (' + (pkg.hasOwnProperty('license') ? (JSON.stringify(pkg.license)).blue : 'none'.red) + ')' + '\n';
        if (pkg.hasOwnProperty('dependencies')) {
            return ret + stringifyDependencies(pkg.dependencies, indent + 4);
        }
    }, '');
};

var outputDependencies = function (data) {
    write('\nLicenses:\n\n'.grey);
    write(stringifyDependencies(data, 4));
    write('\n');
};

npm.load(function (err, res) {
    for (var i = 2; i < process.argv.length; i++) {
        var arg = process.argv[i];
        walkNpmPackageLicenses(arg).then(outputDependencies);
    }
});

