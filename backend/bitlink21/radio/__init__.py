"""BitLink21 radio core.

Pure NumPy/SciPy implementation of the HSModem (DJ0ABR / AMSAT-DL) waveform
and frame format, plus beacon tracking and satellite frequency planning.

Everything in here is hardware-agnostic: it consumes and produces complex
baseband samples, so it can be unit-tested without an SDR attached.
"""
