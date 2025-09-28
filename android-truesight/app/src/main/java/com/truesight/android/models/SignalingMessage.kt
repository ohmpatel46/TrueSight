package com.truesight.android.models

import com.google.gson.annotations.SerializedName

data class SignalingMessage(
    @SerializedName("type")
    val type: String, // 'offer', 'answer', 'ice-candidate', 'join', 'leave'

    @SerializedName("room")
    val room: String,

    @SerializedName("from")
    val from: String,

    @SerializedName("to")
    val to: String? = null,

    @SerializedName("data")
    val data: Any? = null // RTCSessionDescription or RTCIceCandidate
)

data class JoinRoomMessage(
    @SerializedName("room")
    val room: String
)

data class ExistingPeersResponse(
    @SerializedName("peers")
    val peers: List<String>
)

data class PeerJoinedResponse(
    @SerializedName("peerId")
    val peerId: String
)

data class PeerLeftResponse(
    @SerializedName("peerId")
    val peerId: String
)