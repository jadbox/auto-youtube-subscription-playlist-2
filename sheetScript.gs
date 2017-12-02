function doGet(e) {
    // url = https://docs.google.com/spreadsheets/d/XXXXXXXXXX/edit#gid=0
    var sheetID = 'XXXXXXXXXX';  // Paste the Sheet ID here, it's the long string in the Sheet URL

    if (e.parameter.update == "True") {
        var sheet = SpreadsheetApp.openById(sheetID).getSheets()[0];
        updatePlaylists(sheet);
    };

    var t = HtmlService.createTemplateFromFile('index.html');
    t.data = e.parameter.pl
    t.sheetID = sheetID
    return t.evaluate();
}

function getRedditVideoIds(subreddit, rtime, count) {
  count = count || 20;
  subreddit = subreddit || 'videos';
  rtime = rtime || 'day';
  
  var payload = {
    "username": "New Update"
  };

  var url = 'https://t1kfdpz8b4.execute-api.eu-west-1.amazonaws.com/prod/Sheets';
  var options = {
    'method': 'get'
  };

  var response = UrlFetchApp.fetch("https://www.reddit.com/r/"+subreddit+"/top/.json?count="+count+"&t="+rtime,options);
  var json = response.getContentText();
	var data = JSON.parse(json);
    var c = data.data.children;
    var videoids = [];
    for(var i = 0; i < c.length; i++) {
      var child = c[i];
      if(child.data.domain!=='youtube.com') continue;
      //if(!child.data.secure_media) Logger.log(child.data);
      var html_entry = child.data.secure_media.oembed.html;
      //Logger.log("html_entry");
      //Logger.log(html_entry);
      var match = (new RegExp("embed/([a-zA-Z0-9_]+)", "gi")).exec(html_entry);
      if(!match || match.length === 0) continue;
      var vid = match[1];
      //Logger.log(vid);
      videoids.push(vid);
    }
  Logger.log(videoids);
  return videoids;
}

function updatePlaylists(sheet) {
  if (sheet.toString() != 'Sheet') sheet = SpreadsheetApp.openById('XXXXXXXXXX').getSheets()[0]; // Hotfix, Paste the Sheet ID here, it's the long string in the Sheet URL
  var data = sheet.getDataRange().getValues();
  var reservedTableRows = 3; // Start of the range of the PlaylistID+ChannelID data
  var reservedTableColumns = 2; // Start of the range of the ChannelID data
  var reservedTimestampCell = "F1";
  //if (!sheet.getRange(reservedTimestampCell).getValue()) sheet.getRange(reservedTimestampCell).setValue(ISODateString(new Date()));
  if (!sheet.getRange(reservedTimestampCell).getValue()) {
    var date = new Date();
    date.setHours(date.getHours() - 24); // Subscriptions added starting with the last day
    var isodate = date.toISOString();
    sheet.getRange(reservedTimestampCell).setValue(isodate);
  }

  var debugFlag_dontUpdateTimestamp = false;
  var debugFlag_dontUpdatePlaylists = false;

  /// For each playlist...
  for (var iRow = reservedTableRows; iRow < sheet.getLastRow(); iRow++) {
    var playlistId = data[iRow][0];
    if (!playlistId) continue;

    /// ...get channels...
    var channelIds = [];
    var playlistIds = [];
    var subreddits = [];
    for (var iColumn = reservedTableColumns; iColumn < sheet.getLastColumn(); iColumn++) {
      var channel = data[iRow][iColumn];
      if (!channel) continue;
      else if (channel == "ALL")
        channelIds.push.apply(channelIds, getAllChannelIds());
      else if (channel.substring(0,2) == "r/" && channel.length > 3) 
        subreddits.push(channel.replace('r/',''));
      else if (channel.substring(0,2) == "PL" && channel.length > 10)  // Add videos from playlist. MaybeTODO: better validation, since might interpret a channel with a name "PL..." as a playlist ID
         playlistIds.push(channel);
      else if (!(channel.substring(0,2) == "UC" && channel.length > 10)) // Check if it is not a channel ID (therefore a username). MaybeTODO: do a better validation, since might interpret a channel with a name "UC..." as a channel ID
      {
        try {
          channelIds.push(YouTube.Channels.list('id', {forUsername: channel, maxResults: 1}).items[0].id);
        } catch (e) {
          Logger.log("ERROR: " + e.message);
          continue;
        }
      }
      else
        channelIds.push(channel);
    }

    /// ...get videos from the channels...
    var videoIds = [];
    var lastTimestamp = sheet.getRange(reservedTimestampCell).getValue();
    for (var i = 0; i < channelIds.length; i++) {
      videoIds.push.apply(videoIds, getVideoIds(channelIds[i], lastTimestamp)); // Append new videoIds array to the original one
    }
    for (var i = 0; i < playlistIds.length; i++) {
      videoIds.push.apply(videoIds, getPlaylistVideoIds(playlistIds[i], lastTimestamp));
    }
    
    for (var i = 0; i < subreddits.length; i++) {
      videoIds.push.apply(videoIds, getRedditVideoIds(subreddits[i], lastTimestamp));
    }

    //causes only first line to be updated
    //if (!debugFlag_dontUpdateTimestamp) sheet.getRange(reservedTimestampCell).setValue(ISODateString(new Date())); // Update timestamp

    /// ...add videos to the playlist
    if (!debugFlag_dontUpdatePlaylists) {
      for (var i = 0; i < videoIds.length; i++) {
        try {
          YouTube.PlaylistItems.insert
          ( { snippet:
             { playlistId: playlistId,
              resourceId:
              { videoId: videoIds[i],
               kind: 'youtube#video'
              }
             }
            }, 'snippet,contentDetails'
          );
        } catch (e) {
          Logger.log("ERROR: " + e.message);
          continue;
        }

        Utilities.sleep(1000);
      }
    }
  }
  if (!debugFlag_dontUpdateTimestamp) sheet.getRange(reservedTimestampCell).setValue(ISODateString(new Date())); // Update timestamp
}

function getVideoIds(channelId, lastTimestamp) {
  var videoIds = [];

  // First call
  try {

    var results = YouTube.Search.list('id', {
      channelId: channelId,
      maxResults: 50,
      order: "date",
      publishedAfter: lastTimestamp
    });

  } catch (e) {
    Logger.log("ERROR: " + e.message);
    return;
  }

  for (var j = 0; j < results.items.length; j++) {
    var item = results.items[j];
    videoIds.push(item.id.videoId);
  }

  // Other calls
  var nextPageToken = results.nextPageToken;
  for (var pageNo = 0; pageNo < (-1+Math.ceil(results.pageInfo.totalResults / 50.0)); pageNo++) {

    try {
      results = YouTube.Search.list('id', {
        channelId: channelId,
        maxResults: 50,
        order: "date",
        publishedAfter: lastTimestamp,
        pageToken: nextPageToken
      });
    } catch (e) {
      Logger.log("ERROR: " + e.message);
      continue;
    }

    for (var j = 0; j < results.items.length; j++) {
      var item = results.items[j];
      videoIds.push(item.id.videoId);
    }

    nextPageToken = results.nextPageToken;
  }

  return videoIds;
}

function getPlaylistVideoIds(playlistId, lastTimestamp) {
  var videoIds = [];

  var nextPageToken = '';
  while (nextPageToken != null){

    try {
      var results = YouTube.PlaylistItems.list('snippet', {
        playlistId: playlistId,
        maxResults: 50,
        order: "date",
        publishedAfter: lastTimestamp,
        pageToken: nextPageToken});
    } catch (e) {
      Logger.log("ERROR: " + e.message);
      nextPageToken = null;
    }

    for (var j = 0; j < results.items.length; j++) {
      var item = results.items[j];
      if (item.snippet.publishedAt > lastTimestamp)
        videoIds.push(item.snippet.resourceId.videoId);
    }

    nextPageToken = results.nextPageToken;
  }

  return videoIds;
}

function getAllChannelIds() { // get YT Subscriptions-List, src: https://www.reddit.com/r/youtube/comments/3br98c/a_way_to_automatically_add_subscriptions_to/
  var AboResponse, AboList = [[],[]], nextPageToken = [], nptPage = 0, i, ix;

  // Workaround: nextPageToken API-Bug (this Tokens are limited to 1000 Subscriptions... but you can add more Tokens.)
  nextPageToken = ['','CDIQAA','CGQQAA','CJYBEAA','CMgBEAA','CPoBEAA','CKwCEAA','CN4CEAA','CJADEAA','CMIDEAA','CPQDEAA','CKYEEAA','CNgEEAA','CIoFEAA','CLwFEAA','CO4FEAA','CKAGEAA','CNIGEAA','CIQHEAA','CLYHEAA'];
  try {
    do {
      AboResponse = YouTube.Subscriptions.list('snippet', {
        mine: true,
        maxResults: 50,
        order: 'alphabetical',
        pageToken: nextPageToken[nptPage],
        fields: 'items(snippet(title,resourceId(channelId)))'
      });
      for (i = 0, ix = AboResponse.items.length; i < ix; i++) {
        AboList[0][AboList[0].length] = AboResponse.items[i].snippet.title;
        AboList[1][AboList[1].length] = AboResponse.items[i].snippet.resourceId.channelId;
      }
      nptPage += 1;
    } while (AboResponse.items.length > 0 && nptPage < 20);
    if (AboList[0].length !== AboList[1].length) {
      return 'Length Title != ChannelId'; // returns a string === error
    }
  } catch (e) {
    return e;
  }

  Logger.log('Acquired subscriptions %s', AboList[1].length);
  return AboList[1];
}

function getAllChannelIds_OLD() { // Note: this function is not used.
  var channelIds = [];

  // First call
  try {
    var results = YouTube.Subscriptions.list('snippet', {
      mine: true,
      maxResults: 50
    });
  } catch (e) {
    Logger.log("ERROR: " + e.message);
    return;
  }
  for (var i = 0; i < results.items.length; i++) {
    var item = results.items[i];
    channelIds.push(item.snippet.resourceId.channelId);
  }

  // Other calls
  var nextPageToken = results.nextPageToken;
  for (var pageNo = 0; pageNo < (-1+Math.ceil(results.pageInfo.totalResults / 50.0)); pageNo++) {

    try {
      results = YouTube.Subscriptions.list('snippet', {
        mine: true,
        maxResults: 50,
        pageToken: nextPageToken
      });
    } catch (e) {
      Logger.log("ERROR: " + e.message);
      continue;
    }
    for (var i = 0; i < results.items.length; i++) {
      var item = results.items[i];
      channelIds.push(item.snippet.resourceId.channelId);
    }

    nextPageToken = results.nextPageToken;
  }

  Logger.log('Acquired subscriptions %s, Actual subscriptions %s', channelIds.length, results.pageInfo.totalResults);
  return channelIds;
}

function ISODateString(d) { // modified from src: http://stackoverflow.com/questions/7244246/generate-an-rfc-3339-timestamp-similar-to-google-tasks-api
 function pad(n){return n<10 ? '0'+n : n}
 return d.getUTCFullYear()+'-'
      + pad(d.getUTCMonth()+1)+'-'
      + pad(d.getUTCDate())+'T'
      + pad(d.getUTCHours())+':'
      + pad(d.getUTCMinutes())+':'
      + pad(d.getUTCSeconds())+'.000Z'
}

function onOpen() {
  SpreadsheetApp.getActiveSpreadsheet().addMenu("Functions", [{name: "Update Playlists", functionName: "insideUpdate"}]);
}

function insideUpdate(){
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  updatePlaylists(sheet);
}

function playlist(pl, sheetID){
  var sheet = SpreadsheetApp.openById(sheetID).getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var reservedTableRows = 3; // Start of the range of the PlaylistID+ChannelID data
  if (pl == undefined){
    pl = reservedTableRows;
  } else {
    pl = Number(pl) + reservedTableRows - 1;  // I like to think of the first playlist as being number 1.
  }

  if (pl > sheet.getLastRow()){
    pl = sheet.getLastRow();
  }

  var playlistId = data[pl][0];
  return playlistId
}
