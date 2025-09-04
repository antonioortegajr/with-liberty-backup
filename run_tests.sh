#!/bin/bash
pip install -r requirements.txt
export PYTHONPATH=$PYTHONPATH:$(pwd)/lambda
python -m unittest discover tests