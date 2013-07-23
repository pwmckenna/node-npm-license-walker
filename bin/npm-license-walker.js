#!/usr/bin/env node

process.title = 'npm-license-walker';

var write = process.stdout.write.bind(process.stdout);
process.stdout.write = function () {};
process.stderr.write = function () {};

var q = require('q');
var assert = require('assert');
var npm = require('npm');
var request = require('request');
require('colors');
var fs = require('fs');
var _ = require('lodash');

assert(process.argv.length > 2);

var getGitHubRawUrl = function (url) {
    var match = url.match('https://api.github.com/repos/([^/]+)/([^/]+)/contents/([^?]+)\\?ref=(.*)');
    // ["https://...", "mcavage", "node-assert-plus", "README.md", "master"]
    var owner = match[1];
    var project = match[2];
    var file = match[3];
    var branch = match[4];
    

    return 'https://raw.github.com/' + owner + '/' + project + '/' + branch + '/' + file;
};

var requestReadmeLicenseInformation = function (name, contents) {
    var readmeFile = _.find(contents, function (content) {
        return content.name.match(/^readme/i);
    });

    if (!readmeFile) {
        return q.reject('no readme file');
    }

    var readmeContentRequest = q.defer();
    request(getGitHubRawUrl(readmeFile.url), readmeContentRequest.makeNodeResolver());
    return readmeContentRequest.promise.spread(function (res, body) {
        var readmeText = body.split('\n').join(' ');
        var match = readmeText.match(/license/i);
        if (match) {
            var index = readmeText.indexOf(match[0]);
            var licenseText = readmeText.substr(index, 160);
            if (licenseText.length === 160) {
                licenseText += '...';
            }
            return q.resolve(licenseText.yellow);
        } else {
            return q.reject('license not found in readme');
        }
    });
};

var requestLicenseLicenseInformation = function (name, contents) {
    var licenseFile = _.find(contents, function (content) {
        return content.name.match(/^license/i);
    });

    if (!licenseFile) {
        return q.reject('no license file');
    }

    var licenseContentRequest = q.defer();
    request(getGitHubRawUrl(licenseFile.url), licenseContentRequest.makeNodeResolver());
    return licenseContentRequest.promise.spread(function (res, body) {
        var licenseText = body.split('\n').join(' ').substr(0, 160);
        if (licenseText.length === 160) {
            licenseText += '...';
        }
        return q.resolve(licenseText.green);
    });
};

var parseRepositoryLicenseInfoFromRepositoryContents = function (name, contents) {
    return requestLicenseLicenseInformation(name, contents).fail(function () {
        return requestReadmeLicenseInformation(name, contents).fail(function () {
            return q.resolve('no license information found'.red);
        });
    });
};

var requestRepositoryLicenseInformation = function (name, repository) {
    var gitRegex = 'github.com/([^/]+/.*)?(.git$)';
    var urlRegex = 'github.com/([^/]+/.*)?';

    var gitMatch = repository.url.match(gitRegex);
    var urlMatch = repository.url.match(urlRegex);

    var slug = (gitMatch || repository.url.match(urlRegex))[1];
    var username = slug.split('/')[0];
    var project = slug.split('/')[1];

    var contentsRequest = q.defer();
    request({
        url: 'https://api.github.com/repos/' + slug + '/contents',
        json: true
    }, contentsRequest.makeNodeResolver());
    return contentsRequest.promise.spread(function (res, contents) {
        if (res.statusCode !== 200) {
            return q.resolve(JSON.stringify(contents).red);
        } 
        return parseRepositoryLicenseInfoFromRepositoryContents(name, contents);
    }).fail(function (err) {
        write(err);
        return q.reject(err);
    });
};

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
                    dependencies: _.flatten(dependencies),
                };
                if (release.hasOwnProperty('license')) {
                    ret.license = JSON.stringify(release.license).cyan;
                }
                if (release.hasOwnProperty('licenses')) {
                    ret.license = JSON.stringify(release.licenses).cyan;
                }

                if (!ret.hasOwnProperty('license') && release.hasOwnProperty('repository')) {
                    return requestRepositoryLicenseInformation(name, release.repository).then(function (license) {
                        ret.license = license;
                        return q.resolve(ret);
                    });
                } else {
                    if (!ret.hasOwnProperty('license')) {
                        ret.license = 'unknown'.red;
                    }
                    return q.resolve(ret);
                }
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
        var ret = memo + indentation + pkg.name + ' (' + pkg.license + ')' + '\n';
        if (pkg.hasOwnProperty('dependencies')) {
            return ret + stringifyDependencies(pkg.dependencies, indent + 4);
        }
    }, '');
};

var outputDependencies = function (data) {
    write('\nLicenses:\t(' + 'npm license'.cyan + ') (' + 'license file'.green + ') (' + 'readme file'.yellow + ')\n\n');
    write(stringifyDependencies(data, 4));
    write('\n');
};

npm.load(function (err, res) {
    for (var i = 2; i < process.argv.length; i++) {
        var arg = process.argv[i];
        walkNpmPackageLicenses(arg).then(outputDependencies);
    }
});

