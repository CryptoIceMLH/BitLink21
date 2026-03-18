import asyncio
import os
from typing import Optional

import tracker.runner
from audio.audiobroadcaster import AudioBroadcaster
from audio.audiostreamer import WebAudioStreamer
from common.logger import logger
from observations.events import observation_sync
from session.service import active_sdr_clients

# Globals used by audio threads
audio_consumer: Optional[WebAudioStreamer] = None
audio_broadcaster: Optional[AudioBroadcaster] = None


def cleanup_everything():
    """Cleanup function to stop all processes and threads."""
    logger.info("Cleaning up all processes and threads...")

    # Stop all running observations first
    try:
        if observation_sync and observation_sync.executor:
            logger.info("Stopping all running observations...")
            # Get all scheduled APScheduler jobs for observations
            jobs = observation_sync.scheduler.get_jobs()
            observation_ids = set()
            for job in jobs:
                if job.id.startswith("obs_"):
                    # Extract observation_id from job_id format: "obs_{observation_id}_{start|stop}"
                    parts = job.id.split("_")
                    if len(parts) >= 3:
                        obs_id = "_".join(parts[1:-1])  # Handle observation IDs with underscores
                        observation_ids.add(obs_id)

            # Stop each observation
            for obs_id in observation_ids:
                try:
                    event_loop = asyncio.get_event_loop()
                    if event_loop.is_running():
                        asyncio.create_task(observation_sync.executor.stop_observation(obs_id))
                    else:
                        event_loop.run_until_complete(
                            observation_sync.executor.stop_observation(obs_id)
                        )
                    logger.info(f"Stopped observation: {obs_id}")
                except Exception as e:
                    logger.warning(f"Error stopping observation {obs_id}: {e}")

            logger.info("All observations stopped")
    except Exception as e:  # pragma: no cover
        logger.warning(f"Error stopping observations: {e}")

    # Terminate tracker process
    try:
        if tracker.runner.tracker_process and tracker.runner.tracker_process.is_alive():
            logger.info(f"Stopping tracker process PID: {tracker.runner.tracker_process.pid}")

            # Signal graceful shutdown
            tracker.runner.tracker_stop_event.set()

            # Wait up to 3 seconds for graceful exit
            tracker.runner.tracker_process.join(timeout=3.0)

            # Force kill if still alive
            if tracker.runner.tracker_process.is_alive():
                logger.warning("Tracker didn't exit gracefully, force killing...")
                tracker.runner.tracker_process.kill()
                tracker.runner.tracker_process.join()

            logger.info("Tracker process stopped")
    except Exception as e:  # pragma: no cover - best effort cleanup
        logger.warning(f"Error stopping tracker: {e}")

    # Clean up all SDR sessions
    try:
        if active_sdr_clients:
            from session.service import session_service

            logger.info(f"Cleaning up {len(active_sdr_clients)} SDR sessions...")
            session_ids = list(active_sdr_clients.keys())
            for sid in session_ids:
                try:
                    event_loop = asyncio.get_event_loop()
                    if event_loop.is_running():
                        asyncio.create_task(session_service.cleanup_session(sid))
                    else:
                        event_loop.run_until_complete(session_service.cleanup_session(sid))
                    logger.info(f"Cleaned up SDR session: {sid}")
                except Exception as e:  # pragma: no cover - best effort cleanup
                    logger.warning(f"Error cleaning up SDR session {sid}: {e}")
            logger.info("All SDR sessions cleaned up")
    except Exception as e:  # pragma: no cover
        logger.warning(f"Error during SDR sessions cleanup: {e}")

    # Stop audio threads
    try:
        if audio_consumer:
            audio_consumer.stop()
        if audio_broadcaster:
            audio_broadcaster.stop()
    except Exception as e:  # pragma: no cover
        logger.warning(f"Error stopping audio: {e}")

    # Stop all transcription consumers (per-VFO)
    try:
        from pipeline.orchestration.processmanager import process_manager

        if process_manager and process_manager.transcription_manager:
            # Stop all transcription consumers across all SDRs and sessions
            for sdr_id in list(process_manager.processes.keys()):
                process_info = process_manager.processes.get(sdr_id, {})
                transcription_consumers = process_info.get("transcription_consumers", {})
                for session_id in list(transcription_consumers.keys()):
                    process_manager.transcription_manager.stop_transcription(sdr_id, session_id)
            logger.info("All transcription consumers stopped")
    except Exception as e:  # pragma: no cover
        logger.warning(f"Error stopping transcription consumers: {e}")

    logger.info("Cleanup complete")


def signal_handler(signum, frame):
    """Handle SIGINT and SIGTERM signals."""
    logger.info(f"\nReceived signal {signum}, initiating shutdown...")
    cleanup_everything()
    logger.info("Forcing exit...")
    os._exit(0)


def stop_tracker():
    """Simple function to kill the tracker process."""
    try:
        if tracker.runner.tracker_process and tracker.runner.tracker_process.is_alive():
            tracker.runner.tracker_process.kill()
    except Exception:  # pragma: no cover - best effort cleanup
        pass
