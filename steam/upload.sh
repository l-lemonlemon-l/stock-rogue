#!/bin/sh
# Same as upload.ps1 for Mac/Linux: ./steam/upload.sh <user> <path to steamcmd.sh>
"$2" +login "$1" +run_app_build "$(cd "$(dirname "$0")" && pwd)/app_build.vdf" +quit
