"""Write meta.json (CMVN, frame stacking, language and ITN ids) from the model's ONNX metadata.

    python export_meta.py model.int8.onnx > meta.json
"""
import json, sys, onnx

d = {p.key: p.value for p in onnx.load(sys.argv[1], load_external_data=False).metadata_props}
json.dump({
    'negMean': [float(x) for x in d['neg_mean'].split(',')],
    'invStddev': [float(x) for x in d['inv_stddev'].split(',')],
    'lfrWindow': int(d['lfr_window_size']), 'lfrShift': int(d['lfr_window_shift']),
    'langZh': int(d['lang_zh']), 'withoutItn': int(d['without_itn']),
}, sys.stdout)
