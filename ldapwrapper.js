// read in env settings
const graph_azure = require('./graph_azuread');
const config = require('./config');
const helper = require('./helper');
const fs = require('fs');

var encode = require('hashcode').hashCode;
var creator = {};

creator.do = async function () {
  helper.log("create_ldap_entires", "start");

  var db = helper.ReadJSONfile(config.dataFile);

  try {

    if (!fs.existsSync('./.cache')) fs.mkdirSync('./.cache');

    const graph_azureResponse = await graph_azure.getToken(graph_azure.tokenRequest);
    db[config.baseDn] = {
      "objectClass": "domain",
      "dc": config.baseDn.replace('dc=', '').split(",")[0],
      "entryDN": config.baseDn,
      "hasSubordinates": "TRUE",
      "structuralObjectClass": "domain",
      "subschemaSubentry": "cn=Subschema",
      "namingContexts": config.baseDn
    };

    db[config.usersDnSuffix] = {
      "objectClass": "organizationalRole",
      "cn": config.usersDnSuffix.replace("," + config.baseDn, '').replace('cn=', ''),
      "entryDN": config.usersDnSuffix,
      "hasSubordinates": "TRUE",
      "structuralObjectClass": "organizationalRole",
      "subschemaSubentry": "cn=Subschema"
    };

    db[config.groupDnSuffix] = {
      "objectClass": "organizationalRole",
      "cn": config.groupDnSuffix.replace("," + config.baseDn, '').replace('cn=', ''),
      "entryDN": config.groupDnSuffix,
      "hasSubordinates": "TRUE",
      "structuralObjectClass": "organizationalRole",
      "subschemaSubentry": "cn=Subschema"
    };

    var hash = Math.abs(encode().value(config.usersGroupDnSuffix)).toString();
    if (db[config.usersGroupDnSuffix] && db[config.usersGroupDnSuffix].hasOwnProperty('gidNumber')) hash = db[config.usersGroupDnSuffix].gidNumber;

    db[config.usersGroupDnSuffix] = {
      "objectClass": [
        "sambaIdmapEntry",
        "sambaGroupMapping",
        "extensibleObject",
        "posixGroup",
        "top"
      ],
      "cn": "users",
      "entryDN": config.usersGroupDnSuffix,
      "description": "Users default group",
      "displayName": "users",
      "gidNumber": hash,
      "sambaGroupType": "2",
      "sambaSID": "S-1-5-21-" + hash + "-" + hash + "-" + hash,
      "member": [],
      "memberUid": [],
      "hasSubordinates": "FALSE",
      "structuralObjectClass": "posixGroup",
      "subschemaSubentry": "cn=Subschema"
    };

    var groups = await graph_azure.callApi(graph_azure.apiConfig.gri, graph_azureResponse.accessToken);
    helper.SaveJSONtoFile(groups, './.cache/groups.json');
    helper.log("create_ldap_entires", "groups.json saved.");

    var user_to_groups = [];

    for (var i = 0, len = groups.length; i < len; i++) {
      group = groups[i];
      gpName = "cn=" + group.displayName.replace(/\s/g, '') + "," + config.groupDnSuffix;
      gpName = gpName.toLowerCase();

      var hash = Math.abs(encode().value(group.id)).toString();
      if (db[gpName] && db[gpName].hasOwnProperty('gidNumber')) hash = db[gpName].gidNumber;

      db[gpName] = {
        "objectClass": [
          "sambaIdmapEntry",
          "sambaGroupMapping",
          "extensibleObject",
          "posixGroup",
          "top"
        ],
        "cn": group.displayName.replace(/\s/g, ''),
        "entryDN": gpName,
        "description": group.description,
        "displayName": group.displayName,
        "gidNumber": hash,
        "sambaGroupType": "2",
        "sambaSID": group.securityIdentifier,
        "member": [],
        "memberUid": [],
        "hasSubordinates": "FALSE",
        "structuralObjectClass": "posixGroup",
        "subschemaSubentry": "cn=Subschema"
      };

      var members = await graph_azure.callApi(graph_azure.apiConfig.mri, graph_azureResponse.accessToken, { id: group.id });

      for (var t = 0, tlen = members.length; t < tlen; t++) {
        var member = members[t];
        if (member.id != group.id) {
          user_to_groups[member.id] = user_to_groups[member.id] || [config.usersGroupDnSuffix];
          user_to_groups[member.id].push(gpName);
        }
      }

      helper.SaveJSONtoFile(members, './.cache/members_' + group.displayName + '.json');
      helper.log("create_ldap_entires", 'members_' + group.displayName + '.json' + " saved.");
    }

    var users = await graph_azure.callApi(graph_azure.apiConfig.uri, graph_azureResponse.accessToken);
    helper.SaveJSONtoFile(users, './.cache/users.json');
    helper.log("create_ldap_entires", 'users.json' + " saved.");

    for (var i = 0, len = users.length; i < len; i++) {
      user = users[i];
      userPrincipalName = user.userPrincipalName.replace("@" + config.azureDomain, '');

      // ignore external users
      if (userPrincipalName.indexOf("#EXT#") == -1) {
        upName = config.userRdn + "=" + userPrincipalName.replace(/\s/g, '') + "," + config.usersDnSuffix;
        upName = upName.toLowerCase();

        var hash = Math.abs(encode().value(user.id)).toString();
        var sambaNTPassword = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
        var sambaPwdLastSet = 0;
        if (db[upName] && db[upName].hasOwnProperty('sambaNTPassword')) sambaNTPassword = db[upName].sambaNTPassword;
        if (db[upName] && db[upName].hasOwnProperty('sambaPwdLastSet')) sambaPwdLastSet = db[upName].sambaPwdLastSet;



        for (var j = 0, jlen = user_to_groups[user.id].length; j < jlen; j++) {
          let g = user_to_groups[user.id][j];
          db[g].member = db[g].member || [];
          db[g].memberUid = db[g].memberUid || [];
          db[g].member.push(upName);
          db[g].memberUid.push(userPrincipalName);
        }


        db[upName] = {
          "objectClass": [
            "extensibleObject",
            "sambaIdmapEntry",
            "sambaSamAccount",
            "inetOrgPerson",
            "organizationalPerson",
            "person",
            "shadowAccount",
            "posixAccount",
            "top"],
          "cn": user.displayName,
          "entryDN": upName,
          "sn": user.surname,
          "givenName": user.givenName,
          "displayName": user.displayName,
          "uid": userPrincipalName,
          "sAMAccountName": userPrincipalName,
          "uidNumber": hash,
          "gidNumber": db[config.usersGroupDnSuffix].gidNumber,
          "homeDirectory": "/home/" + userPrincipalName,
          "sambaSID": "S-1-5-21-" + hash + "-" + hash + "-" + hash,
          "loginShell": "/bin/sh",
          "mail": user.mail,
          "memberOf": user_to_groups[user.id],
          "sambaAcctFlags": "[U          ]",
          "sambaLMPassword": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          "sambaNTPassword": sambaNTPassword,
          "sambaPasswordHistory": "0000000000000000000000000000000000000000000000000000000000000000",
          "sambaPwdLastSet": sambaPwdLastSet,
          "shadowExpire": "-1",
          "shadowFlag": "0",
          "shadowInactive": "0",
          "shadowLastChange": "17399",
          "shadowMax": "99999",
          "shadowMin": "100000",
          "shadowWarning": "7",
          "hasSubordinates": "FALSE",
          "structuralObjectClass": "inetOrgPerson",
          "subschemaSubentry": "cn=Subschema"
        };


      }
    }

    // save the data file
    helper.SaveJSONtoFile(db, config.dataFile);
    helper.log("create_ldap_entires", "end");

  } catch (error) {
    helper.error("create_ldap_entires", error);
    return db || {};
  }
  return db;
};

module.exports = creator;