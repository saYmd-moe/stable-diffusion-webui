#! /bin/bash

ssh -fgN -L 6789:localhost:7860 localhost -p 4514
conda activate novelai;
export COMMANDLINE_ARGS="--port 7860 --disable-safe-unpickle --medvram --deepdanbooru";
python launch.py;

