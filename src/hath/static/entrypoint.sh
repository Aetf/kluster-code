#!/bin/ash
set -e
set -x

# start hath
exec java -jar "$HatH_JAR" --port="$HatH_PORT" $@
